add_library(ContextHelper SHARED src/ContextHelper.cpp)
target_include_directories(ContextHelper PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
target_link_libraries(ContextHelper PRIVATE user32 ole32 oleaut32 dwmapi advapi32)
