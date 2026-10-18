using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ChronoHeist.Editor
{
    public static class SceneValidator
    {
        public static void EnsureOperativeAnimatorController()
        {
            string[] charPaths = new string[]
            {
                "Assets/Resources/Quaternius/Char_Mannequin.fbx",
                "Assets/Animations/Anim_UAL2.fbx"
            };
            foreach (string cp in charPaths)
            {
                ModelImporter mi = AssetImporter.GetAtPath(cp) as ModelImporter;
                if (mi != null && (mi.animationType != ModelImporterAnimationType.Human || !mi.bakeAxisConversion))
                {
                    mi.bakeAxisConversion = true;
                    mi.animationType = ModelImporterAnimationType.Human;
                    mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                    mi.SaveAndReimport();
                    Debug.Log($"[RIG_IMPORT] Configured Humanoid + BakeAxisConversion on {cp}");
                }
            }

            UnityEngine.Object[] subAssets = AssetDatabase.LoadAllAssetsAtPath("Assets/Animations/Anim_UAL2.fbx");
            AnimationClip idleClip = null;
            AnimationClip runClip = null;
            AnimationClip carryClip = null;
            AnimationClip dashClip = null;

            foreach (UnityEngine.Object sub in subAssets)
            {
                if (sub is AnimationClip ac && !ac.name.StartsWith("__preview__"))
                {
                    if (ac.name.Contains("Idle_Shield_Loop")) idleClip = ac;
                    else if (ac.name.Contains("Walk_Carry_Loop")) { runClip = ac; carryClip = ac; }
                    else if (ac.name.Contains("Sword_Dash")) dashClip = ac;
                }
            }

            if (idleClip != null)
            {
                string ctrlPath = "Assets/Resources/Quaternius/OperativeAnimator.controller";
                if (File.Exists(ctrlPath)) AssetDatabase.DeleteAsset(ctrlPath);

                AnimatorController ctrl = AnimatorController.CreateAnimatorControllerAtPath(ctrlPath);
                AnimatorStateMachine sm = ctrl.layers[0].stateMachine;

                AnimatorState stIdle = sm.AddState("Idle");
                stIdle.motion = idleClip;
                sm.defaultState = stIdle;

                AnimatorState stRun = sm.AddState("Run");
                stRun.motion = runClip != null ? runClip : idleClip;
                stRun.speed = 1.65f;

                AnimatorState stCarry = sm.AddState("Carry");
                stCarry.motion = carryClip != null ? carryClip : idleClip;
                stCarry.speed = 1.35f;

                AnimatorState stDash = sm.AddState("Dash");
                stDash.motion = dashClip != null ? dashClip : idleClip;
                stDash.speed = 1.45f;

                EditorUtility.SetDirty(ctrl);
                AssetDatabase.SaveAssets();
                Debug.Log("[SceneValidator] Created OperativeAnimator.controller with clips: " + idleClip.name);
            }
        }

        public static void RenderAndInspect()
        {
            EnsureOperativeAnimatorController();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            GameObject camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            Camera cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 120f;
            ChronoCameraRig rig = camGo.AddComponent<ChronoCameraRig>();
            rig.TargetCamera = cam;

            GameObject mgrGo = new GameObject("ChronoGameManager");
            ChronoGameManager mgr = mgrGo.AddComponent<ChronoGameManager>();

            // Force initialization
            mgr.SendMessage("Awake", SendMessageOptions.DontRequireReceiver);
            mgr.SendMessage("Start", SendMessageOptions.DontRequireReceiver);

            // Position camera at Tactical 46 deg overview
            camGo.transform.position = new Vector3(0f, 13.5f, -15.5f);
            camGo.transform.rotation = Quaternion.Euler(46f, 0f, 0f);
            cam.fieldOfView = 45f;

            RenderTexture rt = new RenderTexture(1280, 720, 24);
            cam.targetTexture = rt;
            cam.Render();

            RenderTexture.active = rt;
            Texture2D tex = new Texture2D(1280, 720, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
            tex.Apply();

            string outPath = "/Users/mac-chan/.gemini/antigravity/brain/fe164868-e53b-4d0a-9c63-8c54d2d59293/scratch/unity_tactical_preview.png";
            File.WriteAllBytes(outPath, tex.EncodeToPNG());
            Debug.Log("[SceneValidator] Saved tactical preview to " + outPath);

            // Also render Turntable closeup
            camGo.transform.position = new Vector3(-4.5f, 1.85f, -11.5f);
            camGo.transform.rotation = Quaternion.LookRotation((new Vector3(-4.5f, 1.15f, -8.5f) - camGo.transform.position).normalized, Vector3.up);
            cam.fieldOfView = 38f;
            cam.Render();
            tex.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
            tex.Apply();
            string outPath2 = "/Users/mac-chan/.gemini/antigravity/brain/fe164868-e53b-4d0a-9c63-8c54d2d59293/scratch/unity_turntable_preview.png";
            File.WriteAllBytes(outPath2, tex.EncodeToPNG());
            Debug.Log("[SceneValidator] Saved turntable preview to " + outPath2);

            EditorApplication.Exit(0);
        }
    }
}
