using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace ChronoHeist
{
    public static class WebGLBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void JS_NotifyUnityReady();

        [DllImport("__Internal")]
        private static extern void JS_TriggerSynth(string eventName, float intensity);

        [DllImport("__Internal")]
        private static extern void JS_UpdateHudTelemetry(string jsonPayload);

        [DllImport("__Internal")]
        private static extern void JS_NotifyMatchComplete(string jsonPayload);
#endif

        public static void NotifyReady()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            try { JS_NotifyUnityReady(); } catch (Exception) { }
#endif
        }

        public static void TriggerSynth(string eventName, float intensity = 1.0f)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            try { JS_TriggerSynth(eventName, intensity); } catch (Exception) { }
#endif
        }

        public static void SendHudTelemetry(string jsonPayload)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            try { JS_UpdateHudTelemetry(jsonPayload); } catch (Exception) { }
#endif
        }

        public static void SendMatchComplete(string jsonPayload)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            try { JS_NotifyMatchComplete(jsonPayload); } catch (Exception) { }
#endif
        }
    }
}
