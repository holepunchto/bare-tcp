cmake_minimum_required(VERSION 3.25)

project(bare_tcp C)

include(bare)

add_bare_module(bare_tcp)

target_sources(
  ${bare_tcp}
  PRIVATE
    binding.c
)

if(WIN32)
  target_link_libraries(
    ${bare_tcp}
    PUBLIC
      ws2_32
  )
endif()
