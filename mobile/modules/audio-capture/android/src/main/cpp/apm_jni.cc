#include <jni.h>

#include <cstdint>
#include <vector>

#include "modules/audio_processing/include/audio_processing.h"

using webrtc::AudioProcessing;
using webrtc::AudioProcessingBuilder;
using webrtc::StreamConfig;

namespace {

// Echo cancellation only: noise suppression and gain control make the voice
// worse for recognition (spec §2).
struct Aec3 {
  rtc::scoped_refptr<AudioProcessing> apm;
  StreamConfig capture;
  StreamConfig render;
  int delayMs = 0;

  Aec3(int captureRate, int renderRate) : capture(captureRate, 1), render(renderRate, 1) {
    apm = AudioProcessingBuilder().Create();
    AudioProcessing::Config config;
    config.echo_canceller.enabled = true;
    config.echo_canceller.mobile_mode = false;
    config.noise_suppression.enabled = false;
    config.gain_controller1.enabled = false;
    config.gain_controller2.enabled = false;
    config.high_pass_filter.enabled = true;
    apm->ApplyConfig(config);
  }
};

Aec3* from(jlong handle) { return reinterpret_cast<Aec3*>(handle); }

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeCreate(JNIEnv*, jobject, jint captureRate, jint renderRate) {
  return reinterpret_cast<jlong>(new Aec3(captureRate, renderRate));
}

JNIEXPORT void JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeDestroy(JNIEnv*, jobject, jlong handle) {
  delete from(handle);
}

JNIEXPORT void JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeSetDelayMs(JNIEnv*, jobject, jlong handle, jint ms) {
  from(handle)->delayMs = ms;
}

JNIEXPORT void JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeFeedRender(JNIEnv* env, jobject, jlong handle, jshortArray pcm) {
  Aec3* a = from(handle);
  jsize length = env->GetArrayLength(pcm);
  std::vector<int16_t> frame(length), out(length);
  env->GetShortArrayRegion(pcm, 0, length, frame.data());
  a->apm->ProcessReverseStream(frame.data(), a->render, a->render, out.data());
}

JNIEXPORT jint JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeProcess(JNIEnv* env, jobject, jlong handle, jshortArray in, jshortArray out) {
  Aec3* a = from(handle);
  jsize length = env->GetArrayLength(in);
  std::vector<int16_t> input(length), output(length);
  env->GetShortArrayRegion(in, 0, length, input.data());
  a->apm->set_stream_delay_ms(a->delayMs);
  int status = a->apm->ProcessStream(input.data(), a->capture, a->capture, output.data());
  env->SetShortArrayRegion(out, 0, length, output.data());
  return status;
}

JNIEXPORT jint JNICALL Java_ai_kizunaai_sokuji_audiocapture_Aec3_nativeDelayEstimateMs(JNIEnv*, jobject, jlong handle) {
  auto stats = from(handle)->apm->GetStatistics();
  return stats.delay_ms ? *stats.delay_ms : -1;
}

}  // extern "C"
