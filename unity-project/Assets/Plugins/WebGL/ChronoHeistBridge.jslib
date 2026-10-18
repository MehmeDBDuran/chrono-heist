mergeInto(LibraryManager.library, {
  JS_NotifyUnityReady: function () {
    if (typeof window !== "undefined" && window.ChronoHeistHost && window.ChronoHeistHost.onUnityReady) {
      window.ChronoHeistHost.onUnityReady();
    }
  },

  JS_TriggerSynth: function (eventPtr, intensity) {
    var eventName = UTF8ToString(eventPtr);
    if (typeof window !== "undefined" && window.ChronoHeistHost && window.ChronoHeistHost.onSynthTrigger) {
      window.ChronoHeistHost.onSynthTrigger(eventName, intensity);
    }
  },

  JS_UpdateHudTelemetry: function (jsonPtr) {
    var payload = UTF8ToString(jsonPtr);
    if (typeof window !== "undefined" && window.ChronoHeistHost && window.ChronoHeistHost.onHudTelemetry) {
      window.ChronoHeistHost.onHudTelemetry(payload);
    }
  },

  JS_NotifyMatchComplete: function (jsonPtr) {
    var payload = UTF8ToString(jsonPtr);
    if (typeof window !== "undefined" && window.ChronoHeistHost && window.ChronoHeistHost.onMatchComplete) {
      window.ChronoHeistHost.onMatchComplete(payload);
    }
  }
});
