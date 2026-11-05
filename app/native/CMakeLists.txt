cmake_minimum_required(VERSION 3.24)
project(JustSayNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CRT estática: as DLLs não dependem de redistribuível do Visual C++.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
add_compile_options(/utf-8 /W4 /permissive- /EHsc)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_subdirectory(KeyboardHelper)
add_subdirectory(InputHelper)
add_subdirectory(UtilHelper)
add_subdirectory(ContextHelper)
