using System.Collections.Generic;
using UnityEngine;

namespace ChronoHeist
{
    public class PressurePadNode
    {
        public string Id;
        public Vector3 Position;
        public GameObject VisualRoot;
        public Renderer IndicatorRenderer;
        public float CapacitorHoldTimer;
        public bool IsActive => CapacitorHoldTimer > 0f;
    }

    public class LaserGateNode
    {
        public string Id;
        public Vector3 Position;
        public GameObject FrameObj;
        public GameObject GateDoorObj;
        public BoxCollider BlockingCollider;
        public bool IsOpen;
        public float OpenBlend;
    }

    public class DataCoreNode
    {
        public int Id;
        public string Label;
        public int BasePoints;
        public Vector3 HomePosition;
        public Vector3 CurrentPosition;
        public Vector3 Velocity;
        public GameObject PedestalObj;
        public GameObject CoreMeshObj;
        public bool IsExtracted;
        public bool IsInFlight;
        public int ThrownByLoopIndex = -1;
        public int CarriedByActorId = -1; // 0=CurrentPlayer, 1..4=AlliedEcho, 101..104=RivalEcho
        public int ClaimedByAlliedLoop = -1;
    }

    public class MechDroneNode
    {
        public int Id;
        public Vector3 CenterPivot;
        public float OrbitRadius;
        public float PhaseOffset;
        public GameObject DroneObj;
        public Vector3 CurrentPosition;
        public Vector3 ForwardDir;
    }

    public class PhaseVentNode
    {
        public string Id;
        public Vector3 Position;
        public Vector3 ExitPosition;
        public GameObject VentObj;
        public float CooldownTimer;
    }

    public static class CyberVaultSceneBuilder
    {
        // High-Key Industrial Brutalist Palette (Zero Dark Purple/Cyan Slop)
        public static readonly Color ColBoneWhite = new Color(0.95f, 0.94f, 0.91f, 1f);     // #F2EFE8 Alabaster Lab
        public static readonly Color ColWarmPutty = new Color(0.86f, 0.84f, 0.80f, 1f);     // #DBD6CC Warm Concrete
        public static readonly Color ColGunmetal = new Color(0.32f, 0.34f, 0.36f, 1f);      // #52575C Industrial Steel
        public static readonly Color ColCarbon = new Color(0.14f, 0.14f, 0.13f, 1f);        // #242421 Carbon Trim
        public static readonly Color ColSignalOrange = new Color(1.00f, 0.30f, 0.00f, 1f);  // #FF4D00 Allied / Action
        public static readonly Color ColAcidVolt = new Color(0.78f, 1.00f, 0.00f, 1f);      // #C8FF00 Alley-Oop / Ready
        public static readonly Color ColInfraredRed = new Color(0.90f, 0.10f, 0.10f, 1f);   // #E61919 Rival / Laser
        public static readonly Color ColAmberGold = new Color(1.00f, 0.72f, 0.00f, 1f);     // #FFB800 Overdrive / Gold

        private static readonly Dictionary<string, GameObject> _prefabCache = new Dictionary<string, GameObject>();
        private static readonly Dictionary<string, Texture2D> _textureCache = new Dictionary<string, Texture2D>();

        public static GameObject LoadQuaterniusModel(string resourceName)
        {
            if (_prefabCache.TryGetValue(resourceName, out GameObject cached) && cached != null)
            {
                return cached;
            }
            GameObject loaded = Resources.Load<GameObject>("Quaternius/" + resourceName);
            _prefabCache[resourceName] = loaded;
            return loaded;
        }

        public static Texture2D LoadQuaterniusTexture(string texName)
        {
            if (string.IsNullOrEmpty(texName)) return null;
            if (_textureCache.TryGetValue(texName, out Texture2D cached) && cached != null)
            {
                return cached;
            }
            Texture2D loaded = Resources.Load<Texture2D>("Quaternius/Textures/" + texName);
            _textureCache[texName] = loaded;
            return loaded;
        }

        /// <summary>
        /// Spawns a Quaternius FBX inside a clean pivot wrapper GameObject so that:
        /// 1. localPos, localRot, and scale are always applied in PARENT-LOCAL coordinates (never dumping children at world 0,0,0).
        /// 2. The FBX's native Blender-to-Unity -90 deg X rotation and import scale on the child mesh are 100% preserved.
        /// 3. All Quaternius trim-sheet & prop BaseColor/Emissive textures are automatically bound per submesh slot.
        /// </summary>
        public static GameObject SpawnModel(
            string resourceName,
            string instanceName,
            Transform parent,
            Vector3 localPos,
            Quaternion localRot,
            Vector3 scale,
            Color tintColor,
            bool addBoxCollider = false,
            Vector3? colliderSize = null,
            bool forceSolidTint = false)
        {
            GameObject wrapper = new GameObject(instanceName);
            if (parent != null)
            {
                wrapper.transform.SetParent(parent, false);
            }
            wrapper.transform.localPosition = localPos;
            wrapper.transform.localRotation = localRot;
            wrapper.transform.localScale = scale;

            GameObject prefab = LoadQuaterniusModel(resourceName);
            if (prefab != null)
            {
                GameObject meshInst = Object.Instantiate(prefab, wrapper.transform, false);
                meshInst.name = resourceName + "_Mesh";
            }

            BindQuaterniusTexturesAndMaterials(wrapper, resourceName, tintColor, forceSolidTint ? 0.35f : 0f, forceSolidTint);

            if (addBoxCollider)
            {
                BoxCollider bc = wrapper.AddComponent<BoxCollider>();
                if (colliderSize.HasValue)
                {
                    bc.size = colliderSize.Value;
                    bc.center = new Vector3(0f, colliderSize.Value.y * 0.5f, 0f);
                }
            }

            return wrapper;
        }

        public static void BindQuaterniusTexturesAndMaterials(
            GameObject root,
            string resourceHint,
            Color tintColor,
            float emissionStrength = 0f,
            bool overrideAllSlotsWithTint = false)
        {
            Shader std = Shader.Find("Universal Render Pipeline/Lit");
            if (std == null) std = Shader.Find("Standard");
            if (std == null) std = Shader.Find("Legacy Shaders/Diffuse");

            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer r = renderers[i];
                if (r == null) continue;
                Material[] origMats = r.sharedMaterials;
                Material[] newMats = new Material[origMats.Length];

                for (int m = 0; m < origMats.Length; m++)
                {
                    string slotName = origMats[m] != null ? origMats[m].name : "";
                    Material mat = new Material(std);
                    mat.name = slotName + "_Bound";

                    ResolveSlotTextureAndColor(
                        slotName,
                        resourceHint,
                        tintColor,
                        overrideAllSlotsWithTint,
                        out Texture2D baseTex,
                        out Texture2D emTex,
                        out Color resolvedColor,
                        out float smoothness,
                        out float metallic);

                    mat.color = resolvedColor;
                    if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", resolvedColor);
                    if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", smoothness);
                    if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", smoothness);
                    if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", metallic);

                    if (baseTex != null)
                    {
                        mat.mainTexture = baseTex;
                        if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", baseTex);
                    }

                    if (emTex != null || emissionStrength > 0.01f)
                    {
                        mat.EnableKeyword("_EMISSION");
                        if (emTex != null && mat.HasProperty("_EmissionMap"))
                        {
                            mat.SetTexture("_EmissionMap", emTex);
                        }
                        Color emCol = emissionStrength > 0.01f
                            ? resolvedColor * emissionStrength
                            : Color.white * 0.85f;
                        if (mat.HasProperty("_EmissionColor")) mat.SetColor("_EmissionColor", emCol);
                    }

                    newMats[m] = mat;
                }
                r.materials = newMats;
            }
        }

        private static void ResolveSlotTextureAndColor(
            string slotName,
            string resourceHint,
            Color tintColor,
            bool overrideAllSlotsWithTint,
            out Texture2D baseTex,
            out Texture2D emTex,
            out Color resolvedColor,
            out float smoothness,
            out float metallic)
        {
            baseTex = null;
            emTex = null;
            smoothness = 0.38f;
            metallic = 0.15f;

            string s = (slotName ?? "").ToLowerInvariant();
            string r = (resourceHint ?? "").ToLowerInvariant();

            if (s.Contains("trim_01"))
            {
                baseTex = LoadQuaterniusTexture("T_Trim_01_BaseColor");
                emTex = LoadQuaterniusTexture("T_Trim_01_Emissive");
            }
            else if (s.Contains("trim_02"))
            {
                baseTex = LoadQuaterniusTexture("T_Trim_02_BaseColor");
            }
            else if (s.Contains("trim_03_cables"))
            {
                baseTex = LoadQuaterniusTexture("T_Trim_03_Cables");
            }
            else if (s.Contains("trim_03_dark"))
            {
                baseTex = LoadQuaterniusTexture("T_Trim_03_Dark");
                metallic = 0.45f;
            }
            else if (s.Contains("trim_03"))
            {
                baseTex = LoadQuaterniusTexture("T_Trim_03_BaseColor");
            }
            else if (s.Contains("paddedwall"))
            {
                baseTex = LoadQuaterniusTexture("T_PaddedWall_BaseColor");
                emTex = LoadQuaterniusTexture("T_PaddingWall_Emissive");
            }
            else if (s.Contains("decal"))
            {
                baseTex = LoadQuaterniusTexture("T_Decals");
            }
            else if (s.Contains("props_batch1"))
            {
                baseTex = LoadQuaterniusTexture("T_Props_Batch1_BaseColor");
            }
            else if (s.Contains("props_batch2") || r.Contains("core_") || r.Contains("gadget_"))
            {
                baseTex = LoadQuaterniusTexture("T_Props_Batch2_BaseColor");
                emTex = LoadQuaterniusTexture("T_Props_Batch2_Emissive");
            }
            else if (s.Contains("enemies_large") || r.Contains("trilobite"))
            {
                baseTex = LoadQuaterniusTexture("T_Enemies_Large_BaseColor");
                emTex = LoadQuaterniusTexture("T_Enemies_Large_Emissive");
                metallic = 0.4f;
            }
            else if (s.Contains("enemies") || r.Contains("enemy_"))
            {
                baseTex = LoadQuaterniusTexture("T_Enemies_BaseColor");
                emTex = LoadQuaterniusTexture("T_Enemies_Emissive");
                metallic = 0.4f;
            }
            else if (s.Contains("guns_batch1") || r.Contains("baton") || r.Contains("cleaver"))
            {
                baseTex = LoadQuaterniusTexture("T_Guns_Batch1_BaseColor");
                emTex = LoadQuaterniusTexture("T_Guns_Batch1_Emissive");
                metallic = 0.5f;
            }
            else if (s.Contains("guns_batch2") || r.Contains("katana") || r.Contains("tonfa"))
            {
                baseTex = LoadQuaterniusTexture("T_Guns_Batch2_BaseColor");
                emTex = LoadQuaterniusTexture("T_Guns_Batch2_Emissive");
                metallic = 0.5f;
            }
            else if (s.Contains("superhero_male"))
            {
                baseTex = LoadQuaterniusTexture("T_Superhero_Male_Light_BaseColor");
            }
            else if (s.Contains("superhero_female"))
            {
                baseTex = LoadQuaterniusTexture("T_Superhero_Female_Light_BaseColor");
            }
            else if (s.Contains("hair_1"))
            {
                baseTex = LoadQuaterniusTexture("T_Hair_1_BaseColor");
            }
            else if (s.Contains("hair_2"))
            {
                baseTex = LoadQuaterniusTexture("T_Hair_2_BaseColor");
            }
            else if (s.Contains("eyes"))
            {
                baseTex = LoadQuaterniusTexture("T_Eye_Brown");
            }
            else if (s.Contains("m_main"))
            {
                // Cybernetic Operative Outer Armor Plates (Char_Mannequin.fbx)
                baseTex = LoadQuaterniusTexture("T_Trim_01_BaseColor");
                resolvedColor = tintColor;
                smoothness = 0.55f;
                metallic = 0.25f;
                return;
            }
            else if (s.Contains("m_joints") || s.Contains("m_black"))
            {
                // Cybernetic Operative Endo-Skeleton Joints / Dark Trim
                baseTex = LoadQuaterniusTexture("T_Trim_03_Dark");
                resolvedColor = new Color(0.16f, 0.17f, 0.18f, 1f);
                smoothness = 0.45f;
                metallic = 0.6f;
                return;
            }
            else if (s.Contains("m_lightfade") || s.Contains("m_glass"))
            {
                resolvedColor = tintColor;
                smoothness = 0.8f;
                return;
            }

            if (overrideAllSlotsWithTint)
            {
                resolvedColor = tintColor;
            }
            else if (baseTex != null)
            {
                // Preserve crisp texture colors while softly blending architectural tint
                resolvedColor = Color.Lerp(Color.white, tintColor, 0.28f);
            }
            else
            {
                resolvedColor = tintColor;
            }
        }

        public static void ApplyIndustrialMaterial(GameObject root, Color baseColor, float emissionStrength = 0f)
        {
            BindQuaterniusTexturesAndMaterials(root, root != null ? root.name : "", baseColor, emissionStrength, true);
        }

        public static void BuildVaultArena(
            Transform arenaRoot,
            int sectorId,
            List<PressurePadNode> pads,
            List<LaserGateNode> gates,
            List<DataCoreNode> cores,
            List<MechDroneNode> drones,
            List<PhaseVentNode> vents,
            List<Transform> spawnPods)
        {
            for (int i = arenaRoot.childCount - 1; i >= 0; i--)
            {
                Object.Destroy(arenaRoot.GetChild(i).gameObject);
            }
            pads.Clear();
            gates.Clear();
            cores.Clear();
            drones.Clear();
            vents.Clear();
            spawnPods.Clear();

            Color primaryWallColor = sectorId == 2
                ? ColWarmPutty
                : (sectorId == 3 ? new Color(0.90f, 0.92f, 0.95f) : ColBoneWhite);

            // 1. NON-OVERLAPPING 4.0m MODULAR FLOOR GRID (Zero Z-Fighting!)
            // Quaternius Platform_3Plates / Platform_CenterPlate / Platform_X are 4.0m x 4.0m tiles.
            for (int gx = -3; gx <= 3; gx++)
            {
                for (int gz = -3; gz <= 3; gz++)
                {
                    Vector3 tilePos = new Vector3(gx * 4.0f, 0f, gz * 4.0f);
                    bool isCenter = Mathf.Abs(gx) <= 1 && Mathf.Abs(gz) <= 1;
                    bool isNorthVault = gz >= 2 && Mathf.Abs(gx) <= 1;
                    bool isSouthDeck = gz <= -2 && Mathf.Abs(gx) <= 1;

                    string floorModel = isCenter ? "Floor_Center" : ((Mathf.Abs(gx + gz) % 2 == 0) ? "Floor_Main" : "Floor_X");
                    Color floorCol = isNorthVault
                        ? ColWarmPutty
                        : (isSouthDeck ? ColBoneWhite : (isCenter ? ColBoneWhite : ColWarmPutty));

                    SpawnModel(floorModel, $"Floor_{gx}_{gz}", arenaRoot, tilePos, Quaternion.identity, Vector3.one, floorCol, false);
                }
            }

            // Solid ground physics plane below y=0
            GameObject groundColliderObj = new GameObject("GroundPhysicsPlane");
            groundColliderObj.transform.SetParent(arenaRoot, false);
            groundColliderObj.transform.localPosition = new Vector3(0f, -0.25f, 0f);
            BoxCollider groundCol = groundColliderObj.AddComponent<BoxCollider>();
            groundCol.size = new Vector3(32f, 0.5f, 28f);

            // 2. SOUTH EXTRACTION DECK & 4 CRYO SPAWN PODS (L1..L4) — Elevated at y = 0.06f to prevent coplanar Z-fighting
            SpawnModel("Floor_Round", "South_Extraction_Ring", arenaRoot, new Vector3(0f, 0.06f, -8.2f), Quaternion.identity, new Vector3(0.9f, 0.5f, 0.9f), ColSignalOrange, false);
            SpawnModel("Prop_Computer", "Extraction_Terminal", arenaRoot, new Vector3(0f, 0.08f, -10.2f), Quaternion.identity, Vector3.one, ColBoneWhite, false);

            for (int i = 0; i < 4; i++)
            {
                float podX = -4.5f + (i * 3.0f);
                Vector3 podPos = new Vector3(podX, 0.05f, -8.5f);
                GameObject podObj = SpawnModel("Floor_Round", $"CryoPod_L{i + 1}", arenaRoot, podPos, Quaternion.identity, new Vector3(0.55f, 0.5f, 0.55f), ColBoneWhite, false);
                SpawnModel("Column_Hollow", $"CryoPodFrame_L{i + 1}", podObj.transform, new Vector3(0f, 0f, 0.85f), Quaternion.identity, new Vector3(0.75f, 0.85f, 0.75f), ColGunmetal, false);
                spawnPods.Add(podObj.transform);
            }

            // 3. PERIMETER LAB BULKHEAD WALLS (4.0m stride matching Quaternius WallAstra_Straight width)
            for (int gx = -3; gx <= 3; gx++)
            {
                // North Perimeter (z = +11.8)
                SpawnModel("Wall_Astra", $"Wall_North_{gx}", arenaRoot, new Vector3(gx * 4.0f, 0f, 11.8f), Quaternion.identity, Vector3.one, primaryWallColor, true, new Vector3(4.0f, 3.2f, 0.6f));
                // South Perimeter (z = -11.8, Cutaway-friendly in Close Action 3rd-Person Cam)
                SpawnModel("Wall_Window", $"Wall_South_{gx}", arenaRoot, new Vector3(gx * 4.0f, 0f, -11.8f), Quaternion.Euler(0f, 180f, 0f), Vector3.one, primaryWallColor, true, new Vector3(4.0f, 2.8f, 0.6f));
            }
            for (int gz = -2; gz <= 2; gz++)
            {
                // West Perimeter (x = -13.5)
                SpawnModel("Wall_Astra", $"Wall_West_{gz}", arenaRoot, new Vector3(-13.5f, 0f, gz * 4.0f), Quaternion.Euler(0f, 90f, 0f), Vector3.one, primaryWallColor, true, new Vector3(4.0f, 3.2f, 0.6f));
                // East Perimeter (x = +13.5)
                SpawnModel("Wall_Astra", $"Wall_East_{gz}", arenaRoot, new Vector3(13.5f, 0f, gz * 4.0f), Quaternion.Euler(0f, -90f, 0f), Vector3.one, primaryWallColor, true, new Vector3(4.0f, 3.2f, 0.6f));
            }

            // Corner & Center Architectural Columns
            Vector3[] columnPositions = new Vector3[]
            {
                new Vector3(-5.5f, 0f, -4.5f),
                new Vector3( 5.5f, 0f, -4.5f),
                new Vector3(-5.5f, 0f,  5.5f),
                new Vector3( 5.5f, 0f,  5.5f),
                new Vector3( 0.0f, 0f,  0.0f) // Center Chrono Pillar
            };
            for (int i = 0; i < columnPositions.Length; i++)
            {
                string colModel = (i == 4) ? "Column_Pipes" : "Column_Astra";
                Color colTint = (i == 4) ? ColSignalOrange : ColBoneWhite;
                SpawnModel(colModel, $"Column_{i}", arenaRoot, columnPositions[i], Quaternion.identity, Vector3.one, colTint, true, new Vector3(1.2f, 3.2f, 1.2f));
            }

            // 4. THROW-APERTURE WINDOW DIVIDERS (Separating West Cryo Lab, Center Hub & East Reactor Bay)
            float[] dividerZ = new float[] { -2.2f, 0.8f };
            for (int i = 0; i < dividerZ.Length; i++)
            {
                SpawnModel("Wall_ShortAperture", $"Wall_ThrowWindow_W_{i}", arenaRoot, new Vector3(-5.5f, 0f, dividerZ[i]), Quaternion.Euler(0f, 90f, 0f), Vector3.one, ColBoneWhite, true, new Vector3(2.4f, 1.15f, 0.5f));
                SpawnModel("Wall_ShortAperture", $"Wall_ThrowWindow_E_{i}", arenaRoot, new Vector3(5.5f, 0f, dividerZ[i]), Quaternion.Euler(0f, -90f, 0f), Vector3.one, ColBoneWhite, true, new Vector3(2.4f, 1.15f, 0.5f));
            }

            // North Overdrive Vault Bulkhead Walls (Flanking the Central Laser Gate at z = 6.2)
            SpawnModel("Wall_Window", "Wall_Overdrive_Left", arenaRoot, new Vector3(-3.4f, 0f, 6.2f), Quaternion.identity, Vector3.one, ColBoneWhite, true, new Vector3(3.2f, 3.0f, 0.6f));
            SpawnModel("Wall_Window", "Wall_Overdrive_Right", arenaRoot, new Vector3(3.4f, 0f, 6.2f), Quaternion.identity, Vector3.one, ColBoneWhite, true, new Vector3(3.2f, 3.0f, 0.6f));

            // 5. PRESSURE PAD -> LASER GATE CIRCUITS
            CreatePressurePad(arenaRoot, pads, "Pad_Alpha", new Vector3(-8.8f, 0.06f, -1.2f));
            CreatePressurePad(arenaRoot, pads, "Pad_Beta", new Vector3(8.8f, 0.06f, -1.2f));

            CreateLaserGate(arenaRoot, gates, "Gate_North_Overdrive", new Vector3(0f, 0f, 6.2f), Quaternion.identity);
            CreateLaserGate(arenaRoot, gates, "Gate_West_Shortcut", new Vector3(-5.5f, 0f, 3.2f), Quaternion.Euler(0f, 90f, 0f));
            CreateLaserGate(arenaRoot, gates, "Gate_East_Shortcut", new Vector3(5.5f, 0f, 3.2f), Quaternion.Euler(0f, 90f, 0f));

            // 6. SHARED-COOLDOWN PHASE VENTS
            CreatePhaseVent(arenaRoot, vents, "Vent_West", new Vector3(-10.2f, 0.06f, -5.2f), new Vector3(-2.5f, 0f, -6.8f));
            CreatePhaseVent(arenaRoot, vents, "Vent_East", new Vector3(10.2f, 0.06f, -5.2f), new Vector3(2.5f, 0f, -6.8f));

            // 7. DATA CORES & NORTH OVERDRIVE CORE
            CreateDataCore(arenaRoot, cores, 0, "CORE W-1", 150, new Vector3(-8.8f, 0f, 2.2f), false);
            CreateDataCore(arenaRoot, cores, 1, "CORE W-2", 120, new Vector3(-10.2f, 0f, -2.8f), false);
            CreateDataCore(arenaRoot, cores, 2, "CORE E-1", 150, new Vector3(8.8f, 0f, 2.2f), false);
            CreateDataCore(arenaRoot, cores, 3, "CORE E-2", 120, new Vector3(10.2f, 0f, -2.8f), false);
            CreateDataCore(arenaRoot, cores, 4, "HUB CORE", 160, new Vector3(0f, 0f, 2.6f), false);
            CreateDataCore(arenaRoot, cores, 5, "OVERDRIVE CORE", 350, new Vector3(0f, 0f, 8.8f), true);

            // 8. DETERMINISTIC 7.5-SECOND PATROL MECH-DRONES (Textured Quaternius Enemy_QuadShell & Enemy_EyeDrone)
            CreateMechDrone(arenaRoot, drones, 0, "Enemy_QuadShell", new Vector3(-2.6f, 0.05f, -1.8f), 2.4f, 0f);
            CreateMechDrone(arenaRoot, drones, 1, "Enemy_EyeDrone", new Vector3(2.6f, 0.85f, 1.8f), 2.4f, Mathf.PI);

            // Industrial Lab Props (Textured Crates & Barrels)
            SpawnModel("Prop_Crate", "LabCrate_W", arenaRoot, new Vector3(-11.2f, 0f, 4.5f), Quaternion.Euler(0f, 25f, 0f), Vector3.one, ColWarmPutty, false);
            SpawnModel("Prop_Barrel", "LabBarrel_E", arenaRoot, new Vector3(11.2f, 0f, 4.5f), Quaternion.identity, Vector3.one, ColSignalOrange, false);
        }

        private static void CreatePressurePad(Transform root, List<PressurePadNode> pads, string id, Vector3 pos)
        {
            GameObject padObj = SpawnModel("Prop_AccessPoint", id, root, pos, Quaternion.identity, Vector3.one, ColSignalOrange, false);
            GameObject ring = SpawnModel("Floor_Round", id + "_Base", padObj.transform, new Vector3(0f, 0.02f, 0f), Quaternion.identity, new Vector3(0.55f, 0.35f, 0.55f), ColAcidVolt, false, null, true);
            Renderer indRend = ring.GetComponentInChildren<Renderer>();

            pads.Add(new PressurePadNode
            {
                Id = id,
                Position = pos,
                VisualRoot = padObj,
                IndicatorRenderer = indRend,
                CapacitorHoldTimer = 0f
            });
        }

        private static void CreateLaserGate(Transform root, List<LaserGateNode> gates, string id, Vector3 pos, Quaternion rot)
        {
            GameObject frameObj = SpawnModel("Door_Frame", id + "_Frame", root, pos, rot, Vector3.one, ColCarbon, false);
            GameObject doorObj = SpawnModel("Door_Gate", id + "_LaserBarrier", frameObj.transform, Vector3.zero, Quaternion.identity, new Vector3(1.0f, 1.0f, 0.4f), ColInfraredRed, false, null, true);
            BindQuaterniusTexturesAndMaterials(doorObj, "Door_Gate", ColInfraredRed, 0.9f, true);

            BoxCollider bc = frameObj.AddComponent<BoxCollider>();
            bc.size = new Vector3(2.6f, 2.8f, 0.45f);
            bc.center = new Vector3(0f, 1.4f, 0f);

            gates.Add(new LaserGateNode
            {
                Id = id,
                Position = pos,
                FrameObj = frameObj,
                GateDoorObj = doorObj,
                BlockingCollider = bc,
                IsOpen = false,
                OpenBlend = 0f
            });
        }

        private static void CreatePhaseVent(Transform root, List<PhaseVentNode> vents, string id, Vector3 pos, Vector3 exitPos)
        {
            GameObject ventObj = SpawnModel("Prop_Vent", id, root, pos, Quaternion.identity, new Vector3(0.85f, 0.5f, 0.85f), ColAcidVolt, false);
            vents.Add(new PhaseVentNode
            {
                Id = id,
                Position = pos,
                ExitPosition = exitPos,
                VentObj = ventObj,
                CooldownTimer = 0f
            });
        }

        private static void CreateDataCore(Transform root, List<DataCoreNode> cores, int id, string label, int points, Vector3 pos, bool isOverdrive)
        {
            GameObject pedObj = SpawnModel("Prop_ItemHolder", $"CorePedestal_{id}", root, pos, Quaternion.identity, Vector3.one, ColCarbon, false);
            string coreModel = isOverdrive ? "Core_Chest" : "Core_Tube";
            Color coreColor = isOverdrive ? ColAmberGold : ColSignalOrange;
            Vector3 coreScale = isOverdrive ? Vector3.one * 0.65f : Vector3.one * 1.15f;

            GameObject coreMesh = SpawnModel(coreModel, $"DataCore_{id}", root, pos + Vector3.up * 0.95f, Quaternion.identity, coreScale, coreColor, false);
            BindQuaterniusTexturesAndMaterials(coreMesh, coreModel, coreColor, 0.45f, false);

            cores.Add(new DataCoreNode
            {
                Id = id,
                Label = label,
                BasePoints = points,
                HomePosition = pos + Vector3.up * 0.95f,
                CurrentPosition = pos + Vector3.up * 0.95f,
                Velocity = Vector3.zero,
                PedestalObj = pedObj,
                CoreMeshObj = coreMesh,
                IsExtracted = false,
                IsInFlight = false,
                ThrownByLoopIndex = -1,
                CarriedByActorId = -1,
                ClaimedByAlliedLoop = -1
            });
        }

        private static void CreateMechDrone(Transform root, List<MechDroneNode> drones, int id, string modelName, Vector3 pivot, float radius, float phase)
        {
            GameObject droneObj = SpawnModel(modelName, $"MechDrone_{id}", root, pivot, Quaternion.identity, Vector3.one * 0.75f, Color.white, false);
            drones.Add(new MechDroneNode
            {
                Id = id,
                CenterPivot = pivot,
                OrbitRadius = radius,
                PhaseOffset = phase,
                DroneObj = droneObj,
                CurrentPosition = pivot,
                ForwardDir = Vector3.forward
            });
        }
    }
}
