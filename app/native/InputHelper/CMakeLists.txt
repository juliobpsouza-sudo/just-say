add_library(InputHelper SHARED src/InputHelper.cpp)
target_include_directories(InputHelper PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
target_link_libraries(InputHelper PRIVATE user32 ole32 oleaut32)
