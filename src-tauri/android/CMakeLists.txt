cmake_minimum_required(VERSION 3.22.1)
project(dragon_jvm_bridge LANGUAGES CXX)

add_library(dragon_jvm_bridge SHARED dragon_jvm_probe.cpp)
target_compile_features(dragon_jvm_bridge PRIVATE cxx_std_17)
target_compile_options(dragon_jvm_bridge PRIVATE -Wall -Wextra -Werror=return-type)
find_library(android-log log)
find_library(android-lib android)
target_link_libraries(dragon_jvm_bridge PRIVATE ${android-log} ${android-lib} dl)
