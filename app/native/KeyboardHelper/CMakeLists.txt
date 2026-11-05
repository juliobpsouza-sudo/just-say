add_library(KeyboardHelper SHARED
  src/KeyboardHelper.cpp
  src/KeyNames.cpp
)
target_include_directories(KeyboardHelper PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
target_link_libraries(KeyboardHelper PRIVATE user32)
