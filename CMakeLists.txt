cmake_minimum_required(VERSION 3.25)

project(bare_tcp C)

include(bare)

add_bare_module(bare_tcp)

target_sources(
  ${bare_tcp}
  PRIVATE
    binding.c
)
