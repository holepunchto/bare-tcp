#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <utf.h>
#include <uv.h>

#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif

typedef utf8_t bare_tcp_address_t[INET6_ADDRSTRLEN + 1 /* '%' */ + UV_IF_NAMESIZE + 1 /* NULL */];

typedef struct {
  uv_tcp_t handle;

  struct {
    uv_connect_t connect;
    uv_write_t write;
    uv_shutdown_t shutdown;
  } requests;

  uv_buf_t read;

  js_env_t *env;
  js_ref_t *ctx;
  js_ref_t *on_connection;
  js_ref_t *on_connect;
  js_ref_t *on_reset;
  js_ref_t *on_read;
  js_ref_t *on_write;
  js_ref_t *on_end;
  js_ref_t *on_close;

  bool resetting;
  bool closing;
  bool exiting;

  js_deferred_teardown_t *teardown;
} bare_tcp_t;

static inline int
bare_tcp__get_address(js_env_t *env, js_value_t *value, utf8_t *str, size_t len) {
  int err;

  size_t written;
  err = js_get_value_string_utf8(env, value, str, len, &written);
  assert(err == 0);

  if (written == len) {
    err = js_throw_error(env, uv_err_name(UV_ENAMETOOLONG), uv_strerror(UV_ENAMETOOLONG));
    assert(err == 0);

    return -1;
  }

  return 0;
}

static inline int
bare_tcp__to_sockaddr(const utf8_t *ip, uint32_t port, uint32_t family, struct sockaddr_storage *result) {
  if (family == 6) {
    return uv_ip6_addr((char *) ip, (int) port, (struct sockaddr_in6 *) result);
  }

  return uv_ip4_addr((char *) ip, (int) port, (struct sockaddr_in *) result);
}

static inline void
bare_tcp__from_sockaddr(const struct sockaddr *addr, bare_tcp_address_t ip, uint32_t *port, uint32_t *family) {
  int err;

  if (addr->sa_family == AF_INET) {
    const struct sockaddr_in *in = (const struct sockaddr_in *) addr;

    err = uv_inet_ntop(AF_INET, &in->sin_addr, (char *) ip, INET6_ADDRSTRLEN);
    assert(err == 0);

    *port = ntohs(in->sin_port);
    *family = 4;
  } else if (addr->sa_family == AF_INET6) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *) addr;

    err = uv_inet_ntop(AF_INET6, &in6->sin6_addr, (char *) ip, INET6_ADDRSTRLEN);
    assert(err == 0);

    // A link local address is only meaningful together with the interface it
    // is scoped to, so append the zone identifier as `<address>%<zone>`. The
    // address buffer is sized to hold it, and `uv_ip6_addr()` accepts it back.
    if (IN6_IS_ADDR_LINKLOCAL(&in6->sin6_addr) && in6->sin6_scope_id != 0) {
      size_t len = strlen((char *) ip);

      size_t zone_len = sizeof(bare_tcp_address_t) - len - 1 /* '%' */;

      ip[len] = '%';

      if (uv_if_indextoiid(in6->sin6_scope_id, (char *) ip + len + 1, &zone_len) < 0) {
        ip[len] = '\0';
      }
    }

    *port = ntohs(in6->sin6_port);
    *family = 6;
  } else {
    ip[0] = '\0';

    *port = 0;
    *family = 0;
  }
}

static inline int
bare_tcp__buffers(js_env_t *env, js_value_t *value, uv_buf_t **result, uint32_t *len) {
  int err;

  uint32_t bufs_len;
  err = js_get_array_length(env, value, &bufs_len);
  assert(err == 0);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * bufs_len);

  js_value_t **elements = malloc(sizeof(js_value_t *) * bufs_len);

  if ((bufs == NULL || elements == NULL) && bufs_len > 0) {
    free(bufs);
    free(elements);

    err = js_throw_error(env, uv_err_name(UV_ENOMEM), uv_strerror(UV_ENOMEM));
    assert(err == 0);

    return -1;
  }

  err = js_get_array_elements(env, value, elements, bufs_len, 0, NULL);
  assert(err == 0);

  for (uint32_t i = 0; i < bufs_len; i++) {
    uv_buf_t *buf = &bufs[i];

    size_t buf_len;
    err = js_get_typedarray_info(env, elements[i], NULL, (void **) &buf->base, &buf_len, NULL, NULL);
    assert(err == 0);

    buf->len = buf_len;
  }

  free(elements);

  *result = bufs;
  *len = bufs_len;

  return 0;
}

static inline void
bare_tcp__close_socket(uv_os_sock_t socket) {
#ifdef _WIN32
  closesocket(socket);
#else
  close(socket);
#endif
}

static inline void
bare_tcp__close_osfhandle(int fd) {
#ifdef _WIN32
  _close(fd);
#else
  close(fd);
#endif
}

static void
bare_tcp__on_connection(uv_stream_t *server, int status) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) server;

  if (tcp->closing || tcp->exiting) return;

  js_env_t *env = tcp->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_connection;
  err = js_get_reference_value(env, tcp->on_connection, &on_connection);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_connection, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_tcp__on_connect(uv_connect_t *req, int status) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) req->data;

  if (tcp->closing || tcp->resetting || tcp->exiting) return;

  js_env_t *env = tcp->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_connect;
  err = js_get_reference_value(env, tcp->on_connect, &on_connect);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_connect, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_tcp__on_read(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
  if (nread == UV_EOF) nread = 0;
  else if (nread == 0) return;

  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) stream;

  if (tcp->exiting) return;

  js_env_t *env = tcp->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_read;
  err = js_get_reference_value(env, tcp->on_read, &on_read);
  assert(err == 0);

  js_value_t *argv[2];

  if (nread < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name((int) nread), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror((int) nread), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, 0, &argv[1]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, (int32_t) nread, &argv[1]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_read, 2, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_tcp__on_write(uv_write_t *req, int status) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) req->data;

  if (tcp->exiting) return;

  js_env_t *env = tcp->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_write;
  err = js_get_reference_value(env, tcp->on_write, &on_write);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_write, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_tcp__on_shutdown(uv_shutdown_t *req, int status) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) req->data;

  if (tcp->exiting) return;

  js_env_t *env = tcp->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_end;
  err = js_get_reference_value(env, tcp->on_end, &on_end);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_end, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_tcp__on_close(uv_handle_t *handle) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) handle;

  js_env_t *env = tcp->env;

  js_deferred_teardown_t *teardown = tcp->teardown;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, tcp->ctx, &ctx);
  assert(err == 0);

  if (tcp->resetting && !tcp->closing && !tcp->exiting) {
    uv_loop_t *loop;
    err = js_get_env_loop(env, &loop);
    assert(err == 0);

    js_value_t *on_reset;
    err = js_get_reference_value(env, tcp->on_reset, &on_reset);
    assert(err == 0);

    int status = uv_tcp_init(loop, &tcp->handle);

    tcp->resetting = false;

    if (status < 0) tcp->closing = true;

    js_value_t *argv[1];

    if (status < 0) {
      js_value_t *code;
      err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
      assert(err == 0);

      js_value_t *message;
      err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
      assert(err == 0);

      err = js_create_error(env, code, message, &argv[0]);
      assert(err == 0);
    } else {
      err = js_get_null(env, &argv[0]);
      assert(err == 0);
    }

    js_call_function(env, ctx, on_reset, 1, argv, NULL);

    if (status >= 0) {
      err = js_close_handle_scope(env, scope);
      assert(err == 0);

      return;
    }
  }

  js_value_t *on_close;
  err = js_get_reference_value(env, tcp->on_close, &on_close);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_connection);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_connect);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_reset);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_read);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_write);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_end);
  assert(err == 0);

  err = js_delete_reference(env, tcp->on_close);
  assert(err == 0);

  err = js_delete_reference(env, tcp->ctx);
  assert(err == 0);

  if (!tcp->exiting) js_call_function(env, ctx, on_close, 0, NULL, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  err = js_finish_deferred_teardown_callback(teardown);
  assert(err == 0);
}

static void
bare_tcp__on_teardown(js_deferred_teardown_t *handle, void *data) {
  bare_tcp_t *tcp = (bare_tcp_t *) data;

  tcp->exiting = true;

  if (tcp->closing || tcp->resetting) return;

  uv_close((uv_handle_t *) &tcp->handle, bare_tcp__on_close);
}

static void
bare_tcp__on_alloc(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  bare_tcp_t *tcp = (bare_tcp_t *) handle;

  *buf = tcp->read;
}

static js_value_t *
bare_tcp_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 9;
  js_value_t *argv[9];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 9);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  js_value_t *handle;

  bare_tcp_t *tcp;
  err = js_create_arraybuffer(env, sizeof(bare_tcp_t), (void **) &tcp, &handle);
  assert(err == 0);

  err = uv_tcp_init(loop, &tcp->handle);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  tcp->env = env;
  tcp->resetting = false;
  tcp->closing = false;
  tcp->exiting = false;

  size_t read_len;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &tcp->read.base, &read_len, NULL, NULL);
  assert(err == 0);

  tcp->read.len = read_len;

  err = js_create_reference(env, argv[1], 1, &tcp->ctx);
  assert(err == 0);

  err = js_create_reference(env, argv[2], 1, &tcp->on_connection);
  assert(err == 0);

  err = js_create_reference(env, argv[3], 1, &tcp->on_connect);
  assert(err == 0);

  err = js_create_reference(env, argv[4], 1, &tcp->on_reset);
  assert(err == 0);

  err = js_create_reference(env, argv[5], 1, &tcp->on_read);
  assert(err == 0);

  err = js_create_reference(env, argv[6], 1, &tcp->on_write);
  assert(err == 0);

  err = js_create_reference(env, argv[7], 1, &tcp->on_end);
  assert(err == 0);

  err = js_create_reference(env, argv[8], 1, &tcp->on_close);
  assert(err == 0);

  err = js_add_deferred_teardown_callback(env, bare_tcp__on_teardown, (void *) tcp, &tcp->teardown);
  assert(err == 0);

  return handle;
}

static js_value_t *
bare_tcp_connect(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 4;
  js_value_t *argv[4];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 4);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uint32_t port;
  err = js_get_value_uint32(env, argv[1], &port);
  assert(err == 0);

  bare_tcp_address_t ip;
  if (bare_tcp__get_address(env, argv[2], ip, sizeof(ip)) < 0) return NULL;

  uint32_t family;
  err = js_get_value_uint32(env, argv[3], &family);
  assert(err == 0);

  struct sockaddr_storage addr;

  err = bare_tcp__to_sockaddr(ip, port, family, &addr);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  uv_connect_t *req = &tcp->requests.connect;

  req->data = tcp;

  err = uv_tcp_connect(req, &tcp->handle, (struct sockaddr *) &addr, bare_tcp__on_connect);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_reset(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  if (tcp->closing) return NULL;

  tcp->resetting = true;

  uv_close((uv_handle_t *) &tcp->handle, bare_tcp__on_close);

  return NULL;
}

static js_value_t *
bare_tcp_bind(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 5;
  js_value_t *argv[5];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 5);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uint32_t port;
  err = js_get_value_uint32(env, argv[1], &port);
  assert(err == 0);

  bare_tcp_address_t ip;
  if (bare_tcp__get_address(env, argv[2], ip, sizeof(ip)) < 0) return NULL;

  uint32_t family;
  err = js_get_value_uint32(env, argv[3], &family);
  assert(err == 0);

  uint32_t backlog;
  err = js_get_value_uint32(env, argv[4], &backlog);
  assert(err == 0);

  struct sockaddr_storage addr;

  err = bare_tcp__to_sockaddr(ip, port, family, &addr);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  err = uv_tcp_bind(&tcp->handle, (struct sockaddr *) &addr, 0);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  err = uv_listen((uv_stream_t *) &tcp->handle, (int) backlog, bare_tcp__on_connection);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  int32_t fd;
  err = js_get_value_int32(env, argv[1], &fd);
  assert(err == 0);

  uv_os_sock_t sock = (uv_os_sock_t) uv_get_osfhandle(fd);

  err = uv_tcp_open(&tcp->handle, sock);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_accept(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *server;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &server, NULL);
  assert(err == 0);

  bare_tcp_t *client;
  err = js_get_arraybuffer_info(env, argv[1], (void **) &client, NULL);
  assert(err == 0);

  err = uv_accept((uv_stream_t *) &server->handle, (uv_stream_t *) &client->handle);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_resume(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  if (!uv_is_readable((uv_stream_t *) &tcp->handle)) return NULL;

  err = uv_read_start((uv_stream_t *) &tcp->handle, bare_tcp__on_alloc, bare_tcp__on_read);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_pause(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  if (!uv_is_readable((uv_stream_t *) &tcp->handle)) return NULL;

  err = uv_read_stop((uv_stream_t *) &tcp->handle);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_writev(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uv_buf_t *bufs;
  uint32_t bufs_len;
  if (bare_tcp__buffers(env, argv[1], &bufs, &bufs_len) < 0) return NULL;

  uv_write_t *req = &tcp->requests.write;

  req->data = tcp;

  err = uv_write(req, (uv_stream_t *) &tcp->handle, bufs, bufs_len, bare_tcp__on_write);

  free(bufs);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_end(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uv_shutdown_t *req = &tcp->requests.shutdown;

  req->data = tcp;

  err = uv_shutdown(req, (uv_stream_t *) &tcp->handle, bare_tcp__on_shutdown);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_close(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  if (tcp->closing) return NULL;

  tcp->closing = true;

  if (tcp->resetting) return NULL;

  uv_close((uv_handle_t *) &tcp->handle, bare_tcp__on_close);

  return NULL;
}

static js_value_t *
bare_tcp_address(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  bool local;
  err = js_get_value_bool(env, argv[1], &local);
  assert(err == 0);

  struct sockaddr_storage addr;
  int len = sizeof(addr);

  if (local) {
    err = uv_tcp_getsockname(&tcp->handle, (struct sockaddr *) &addr, &len);
  } else {
    err = uv_tcp_getpeername(&tcp->handle, (struct sockaddr *) &addr, &len);
  }

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  bare_tcp_address_t ip;
  uint32_t port;
  uint32_t family;

  bare_tcp__from_sockaddr((struct sockaddr *) &addr, ip, &port, &family);

  if (family == 0) {
    err = js_throw_error(env, uv_err_name(UV_EAI_ADDRFAMILY), uv_strerror(UV_EAI_ADDRFAMILY));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_object(env, &result);
  assert(err == 0);

  js_value_t *result_address;
  err = js_create_string_utf8(env, ip, -1, &result_address);
  assert(err == 0);

  js_value_t *result_family;
  err = js_create_uint32(env, family, &result_family);
  assert(err == 0);

  js_value_t *result_port;
  err = js_create_uint32(env, port, &result_port);
  assert(err == 0);

  err = js_set_named_property(env, result, "address", result_address);
  assert(err == 0);

  err = js_set_named_property(env, result, "family", result_family);
  assert(err == 0);

  err = js_set_named_property(env, result, "port", result_port);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_tcp_keepalive(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 3);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  bool enable;
  err = js_get_value_bool(env, argv[1], &enable);
  assert(err == 0);

  uint32_t delay;
  err = js_get_value_uint32(env, argv[2], &delay);
  assert(err == 0);

  err = uv_tcp_keepalive(&tcp->handle, enable, (unsigned int) delay);

  if (err == UV_EINVAL && enable && delay == 0) err = 0;

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_nodelay(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  bool enable;
  err = js_get_value_bool(env, argv[1], &enable);
  assert(err == 0);

  err = uv_tcp_nodelay(&tcp->handle, enable);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_tcp_ref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uv_ref((uv_handle_t *) &tcp->handle);

  return NULL;
}

static js_value_t *
bare_tcp_unref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uv_unref((uv_handle_t *) &tcp->handle);

  return NULL;
}

static js_value_t *
bare_tcp_socketpair(js_env_t *env, js_callback_info_t *info) {
  int err;

  uv_os_sock_t socks[2];
  err = uv_socketpair(SOCK_STREAM, 0, socks, UV_NONBLOCK_PIPE, UV_NONBLOCK_PIPE);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  int fds[2];
  fds[0] = uv_open_osfhandle((uv_os_fd_t) socks[0]);
  fds[1] = uv_open_osfhandle((uv_os_fd_t) socks[1]);

  if (fds[0] < 0 || fds[1] < 0) {
    for (int i = 0; i < 2; i++) {
      if (fds[i] < 0) bare_tcp__close_socket(socks[i]);
      else bare_tcp__close_osfhandle(fds[i]);
    }

    err = js_throw_error(env, uv_err_name(UV_EBADF), uv_strerror(UV_EBADF));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_array_with_length(env, 2, &result);
  assert(err == 0);

  js_value_t *first;
  err = js_create_int32(env, fds[0], &first);
  assert(err == 0);

  js_value_t *second;
  err = js_create_int32(env, fds[1], &second);
  assert(err == 0);

  err = js_set_element(env, result, 0, first);
  assert(err == 0);

  err = js_set_element(env, result, 1, second);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_tcp_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("init", bare_tcp_init)
  V("connect", bare_tcp_connect)
  V("reset", bare_tcp_reset)
  V("bind", bare_tcp_bind)
  V("open", bare_tcp_open)
  V("accept", bare_tcp_accept)
  V("resume", bare_tcp_resume)
  V("pause", bare_tcp_pause)
  V("writev", bare_tcp_writev)
  V("end", bare_tcp_end)
  V("close", bare_tcp_close)
  V("address", bare_tcp_address)
  V("keepalive", bare_tcp_keepalive)
  V("nodelay", bare_tcp_nodelay)
  V("ref", bare_tcp_ref)
  V("unref", bare_tcp_unref)
  V("socketpair", bare_tcp_socketpair)
#undef V

#define V(name, n) \
  { \
    js_value_t *val; \
    err = js_create_uint32(env, n, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("MAX_ADDRESS_LENGTH", sizeof(bare_tcp_address_t) - 1 /* NULL */)
#undef V

  return exports;
}

BARE_MODULE(bare_tcp, bare_tcp_exports)
