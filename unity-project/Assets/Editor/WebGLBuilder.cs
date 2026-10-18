using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace ChronoHeist.Editor
{
    public static class WebGLBuilder
    {
        [MenuItem("ChronoHeist/Build WebGL Client")]
        public static void Build()
        {
            Console.WriteLine("=== [ChronoHeist] Starting Automated Unity 6 WebGL Build ===");
            SceneValidator.EnsureOperativeAnimatorController();

            // 1. Ensure Scene Directory & Create ChronoCrucible.unity
            string sceneDir = "Assets/Scenes";
            if (!Directory.Exists(sceneDir))
            {
                Directory.CreateDirectory(sceneDir);
            }

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // Create Main Camera with ChronoCameraRig
            GameObject camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            Camera cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 120f;
            camGo.AddComponent<AudioListener>();
            ChronoCameraRig rig = camGo.AddComponent<ChronoCameraRig>();
            rig.TargetCamera = cam;

            // Create ChronoGameManager host object (named "ChronoGameManager" so browser SendMessage targets it)
            GameObject mgrGo = new GameObject("ChronoGameManager");
            mgrGo.AddComponent<ChronoGameManager>();

            string scenePath = "Assets/Scenes/ChronoCrucible.unity";
            EditorSceneManager.SaveScene(scene, scenePath);

            EditorBuildSettings.scenes = new EditorBuildSettingsScene[]
            {
                new EditorBuildSettingsScene(scenePath, true)
            };

            // 2. Configure WebGL Player Settings for Fast, Universal Browser & Vercel Hosting
            PlayerSettings.companyName = "ParadoxSyndicate";
            PlayerSettings.productName = "Chrono Heist: Paradox Protocol";
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.WebGL.dataCaching = false;
            PlayerSettings.runInBackground = true;

            string outputPath = Path.GetFullPath(Path.Combine(Application.dataPath, "../../public/unity-build"));
            if (!Directory.Exists(outputPath))
            {
                Directory.CreateDirectory(outputPath);
            }

            BuildPlayerOptions buildOptions = new BuildPlayerOptions
            {
                scenes = new[] { scenePath },
                locationPathName = outputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };

            var report = BuildPipeline.BuildPlayer(buildOptions);
            if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            {
                Console.Error.WriteLine($"=== [ChronoHeist] WebGL Build Failed: {report.summary.result} ===");
                EditorApplication.Exit(1);
            }
            else
            {
                Console.WriteLine($"=== [ChronoHeist] WebGL Build Succeeded -> {outputPath} ===");
                EditorApplication.Exit(0);
            }
        }
    }
}
