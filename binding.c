#include <assert.h>
#include <bare.h>
#include <stdlib.h>
#include <uv.h>

typedef struct {
  uv_tcp_t handle;

  struct {
    uv_connect_t connect;
    uv_write_t write;
  } requests;

  js_env_t *env;
  js_ref_t *ctx;
  js_ref_t *on_connect;
} bare_tcp_t;

static void
bare_tcp__on_connect (uv_connect_t *req, int status) {
  int err;

  bare_tcp_t *tcp = (bare_tcp_t *) req->data;

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

  js_call_function(env, ctx, on_connect, 0, NULL, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static js_value_t *
bare_tcp_init (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  uv_loop_t *loop;
  js_get_env_loop(env, &loop);

  js_value_t *handle;

  bare_tcp_t *tcp;
  err = js_create_arraybuffer(env, sizeof(bare_tcp_t), (void **) &tcp, &handle);
  assert(err == 0);

  err = uv_tcp_init(loop, &tcp->handle);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  tcp->env = env;

  err = js_create_reference(env, argv[0], 1, &tcp->ctx);
  assert(err == 0);

  err = js_create_reference(env, argv[1], 1, &tcp->on_connect);
  assert(err == 0);

  return handle;
}

static js_value_t *
bare_tcp_connect (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 3);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  uint32_t port;
  err = js_get_value_uint32(env, argv[1], &port);
  assert(err == 0);

  utf8_t ip[17];
  err = js_get_value_string_utf8(env, argv[2], ip, 17, NULL);
  assert(err == 0);

  struct sockaddr_in addr;
  err = uv_ip4_addr((char *) ip, port, &addr);

  uv_connect_t *req = &tcp->requests.connect;
  req->data = tcp;

  uv_tcp_connect(req, &tcp->handle, (struct sockaddr *) &addr, bare_tcp__on_connect);

  return NULL;
}

static js_value_t *
bare_tcp_writev (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_tcp_t *tcp;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &tcp, NULL);
  assert(err == 0);

  js_value_t *arr = argv[1];

  uint32_t bufs_len;
  err = js_get_array_length(env, arr, &bufs_len);
  assert(err == 0);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * bufs_len);

  for (uint32_t i = 0; i < bufs_len; i++) {
    js_value_t *item;
    err = js_get_element(env, arr, i, &item);
    assert(err == 0);

    uv_buf_t *buf = &bufs[i];
    err = js_get_typedarray_info(env, item, NULL, (void **) &buf->base, (size_t *) &buf->len, NULL, NULL);
    assert(err == 0);
  }

  uv_write_t *req = &tcp->requests.write;

  req->data = tcp;

  err = uv_write(req, (uv_stream_t *) &tcp->handle, bufs, bufs_len, NULL);

  free(bufs);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
init (js_env_t *env, js_value_t *exports) {
  {
    js_value_t *fn;
    js_create_function(env, "init", -1, bare_tcp_init, NULL, &fn);
    js_set_named_property(env, exports, "init", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "connect", -1, bare_tcp_connect, NULL, &fn);
    js_set_named_property(env, exports, "connect", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "writev", -1, bare_tcp_writev, NULL, &fn);
    js_set_named_property(env, exports, "writev", fn);
  }

  return exports;
}

BARE_MODULE(bare_tcp, init)
