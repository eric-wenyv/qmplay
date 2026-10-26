#include <jni.h>
#include <node.h>
#include <android/log.h>
#include <unistd.h>
#include <thread>
#include <string>
#include <vector>
#include <cstring>

extern "C" JNIEXPORT jint JNICALL
Java_app_qmplay_MusicService_startNode(JNIEnv* env, jclass, jstring script, jstring web,
                                     jstring auth, jint port, jstring token) {
  auto stringValue = [env](jstring value) {
    const char* bytes = env->GetStringUTFChars(value, nullptr);
    std::string result(bytes);
    env->ReleaseStringUTFChars(value, bytes);
    return result;
  };
  std::vector<std::string> args = {"node", stringValue(script), stringValue(web),
                                 std::to_string(port), stringValue(token)};
  setenv("QQ_MUSIC_AUTH_DIR", stringValue(auth).c_str(), 1);
  setenv("NODE_ENV", "production", 1);
  // Node's stdout/stderr belong in Android's process log, never in the UI.
  int logs[2];
  if (pipe(logs) == 0) {
    dup2(logs[1], STDOUT_FILENO);
    dup2(logs[1], STDERR_FILENO);
    close(logs[1]);
    std::thread([fd = logs[0]] {
      char buffer[2048];
      ssize_t size;
      while ((size = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[size] = 0;
        __android_log_write(ANDROID_LOG_INFO, "qmplay-node", buffer);
      }
      close(fd);
    }).detach();
  }
  std::vector<char*> argv;
  size_t length = 0;
  for (const auto& arg : args) length += arg.size() + 1;
  std::vector<char> storage(length);
  char* cursor = storage.data();
  for (const auto& arg : args) {
    argv.push_back(cursor);
    std::memcpy(cursor, arg.c_str(), arg.size() + 1);
    cursor += arg.size() + 1;
  }
  return node::Start(static_cast<int>(argv.size()), argv.data());
}
