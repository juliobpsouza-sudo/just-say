add_library(UtilHelper SHARED src/UtilHelper.cpp)
target_include_directories(UtilHelper PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../common)
target_link_libraries(UtilHelper PRIVATE ole32 oleaut32 powrprof advapi32 shell32 wbemuuid)
