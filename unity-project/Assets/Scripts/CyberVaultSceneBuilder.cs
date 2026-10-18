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
        public static readonly Color ColBoneWhite = new Color(0.92f, 0.90f, 0.87f, 1f);     // #EAE6DF Alabaster Lab
        public static readonly Color ColWarmPutty = new Color(0.82f, 0.79f, 0.74f, 1f);     // #D1C9BD Warm Concrete
        public static readonly Color ColGunmetal = new Color(0.18f, 0.19f, 0.20f, 1f);      // #2E3033 Gunmetal Grate
        public static readonly Color ColCarbon = new Color(0.09f, 0.09f, 0.08f, 1f);        // #171714 Carbon Trim
        public static readonly Color ColSignalOrange = new Color(1.00f, 0.30f, 0.00f, 1f);  // #FF4D00 Allied / Action
        public static readonly Color ColAcidVolt = new Color(0.78f, 1.00f, 0.00f, 1f);      // #C8FF00 Alley-Oop / Ready
        public static readonly Color ColInfraredRed = new Color(0.90f, 0.10f, 0.10f, 1f);   // #E61919 Rival / Laser
        public static readonly Color ColAmberGold = new Color(1.00f, 0.72f, 0.00f, 1f);     // #FFB800 Overdrive / Gold

        private static readonly Dictionary<string, GameObject> _prefabCache = new Dictionary<string, GameObject>();

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

        public static GameObject SpawnModel(
            string resourceName,
            string instanceName,
            Transform parent,
            Vector3 pos,
            Quaternion rot,
            Vector3 scale,
            Color tintColor,
            bool addBoxCollider = false,
            Vector3? colliderSize = null)
        {
            GameObject prefab = LoadQuaterniusModel(resourceName);
            GameObject inst;
            if (prefab != null)
            {
                inst = Object.Instantiate(prefab, pos, rot, parent);
            }
            else
            {
                inst = new GameObject(instanceName);
                inst.transform.SetParent(parent);
                inst.transform.SetPositionAndRotation(pos, rot);
            }

            inst.name = instanceName;
            inst.transform.localScale = scale;

            ApplyIndustrialMaterial(inst, tintColor);

            if (addBoxCollider)
            {
                BoxCollider bc = inst.GetComponent<BoxCollider>();
                if (bc == null) bc = inst.AddComponent<BoxCollider>();
                if (colliderSize.HasValue)
                {
                    bc.size = colliderSize.Value;
                    bc.center = new Vector3(0f, colliderSize.Value.y * 0.5f, 0f);
                }
            }

            return inst;
        }

        public static void ApplyIndustrialMaterial(GameObject root, Color baseColor, float emissionStrength = 0f)
        {
            Shader std = Shader.Find("Universal Render Pipeline/Lit");
            if (std == null) std = Shader.Find("Standard");
            if (std == null) std = Shader.Find("Legacy Shaders/Diffuse");

            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer r = renderers[i];
                if (r == null) continue;
                Material[] mats = r.materials;
                for (int m = 0; m < mats.Length; m++)
                {
                    Material mat = new Material(std);
                    mat.color = baseColor;
                    if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", baseColor);
                    if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", 0.35f);
                    if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.35f);
                    if (emissionStrength > 0.01f)
                    {
                        mat.EnableKeyword("_EMISSION");
                        Color em = baseColor * emissionStrength;
                        if (mat.HasProperty("_EmissionColor")) mat.SetColor("_EmissionColor", em);
                    }
                    mats[m] = mat;
                }
                r.materials = mats;
            }
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
            // Clear existing children
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

            Color primaryWallColor = sectorId == 2 ? ColWarmPutty : (sectorId == 3 ? new Color(0.88f, 0.89f, 0.92f) : ColBoneWhite);

            // 1. MODULAR FLOOR GRID (5 Interconnected Zones: South Deck, Center Hub, West Cryo Lab, East Reactor Bay, North Overdrive Vault)
            for (int gx = -6; gx <= 6; gx++)
            {
                for (int gz = -5; gz <= 5; gz++)
                {
                    Vector3 tilePos = new Vector3(gx * 2.0f, 0f, gz * 2.0f);
                    bool isCenter = Mathf.Abs(gx) <= 2 && Mathf.Abs(gz) <= 2;
                    bool isNorthVault = gz >= 4 && Mathf.Abs(gx) <= 2;
                    bool isSouthDeck = gz <= -4 && Mathf.Abs(gx) <= 2;

                    string floorModel = isCenter ? "Floor_Center" : ((gx + gz) % 2 == 0 ? "Floor_Main" : "Floor_X");
                    Color floorCol = isNorthVault ? ColCarbon : (isSouthDeck ? ColWarmPutty : (isCenter ? ColBoneWhite : ColGunmetal));

                    SpawnModel(floorModel, $"Floor_{gx}_{gz}", arenaRoot, tilePos, Quaternion.identity, Vector3.one, floorCol, false);
                }
            }

            // Invisible solid ground physics plane so ballistic cores and characters have zero seam-snags
            GameObject groundColliderObj = new GameObject("GroundPhysicsPlane");
            groundColliderObj.transform.SetParent(arenaRoot);
            groundColliderObj.transform.localPosition = new Vector3(0f, -0.25f, 0f);
            BoxCollider groundCol = groundColliderObj.AddComponent<BoxCollider>();
            groundCol.size = new Vector3(32f, 0.5f, 28f);

            // 2. SOUTH EXTRACTION DECK & 4 CRYO SPAWN PODS (L1..L4)
            SpawnModel("Floor_Round", "South_Extraction_Ring", arenaRoot, new Vector3(0f, 0.04f, -8.2f), Quaternion.identity, new Vector3(1.6f, 1f, 1.6f), ColSignalOrange, false);
            SpawnModel("Prop_Computer", "Extraction_Terminal", arenaRoot, new Vector3(0f, 0.05f, -9.8f), Quaternion.Euler(0f, 180f, 0f), Vector3.one * 1.15f, ColCarbon, false);

            for (int i = 0; i < 4; i++)
            {
                float podX = -4.5f + (i * 3.0f);
                Vector3 podPos = new Vector3(podX, 0.03f, -8.5f);
                GameObject podObj = SpawnModel("Floor_Round", $"CryoPod_L{i + 1}", arenaRoot, podPos, Quaternion.identity, new Vector3(0.85f, 1.2f, 0.85f), ColBoneWhite, false);
                SpawnModel("Column_Hollow", $"CryoPodFrame_L{i + 1}", podObj.transform, new Vector3(0f, 0f, -0.55f), Quaternion.identity, new Vector3(0.55f, 0.75f, 0.55f), ColGunmetal, false);
                spawnPods.Add(podObj.transform);
            }

            // 3. PERIMETER LAB BULKHEAD WALLS & COLUMNS
            for (int gx = -6; gx <= 6; gx += 2)
            {
                // North Perimeter
                SpawnModel("Wall_Astra", $"Wall_North_{gx}", arenaRoot, new Vector3(gx * 2.0f, 0f, 11.0f), Quaternion.identity, new Vector3(1.05f, 1.15f, 1.0f), primaryWallColor, true, new Vector3(3.8f, 3.2f, 0.6f));
                // South Perimeter (Cutaway-friendly when in Close Action 3rd-Person Cam)
                SpawnModel("Wall_Window", $"Wall_South_{gx}", arenaRoot, new Vector3(gx * 2.0f, 0f, -11.2f), Quaternion.Euler(0f, 180f, 0f), new Vector3(1.05f, 0.9f, 1.0f), primaryWallColor, true, new Vector3(3.8f, 2.5f, 0.6f));
            }
            for (int gz = -5; gz <= 5; gz += 2)
            {
                // West Perimeter
                SpawnModel("Wall_Astra", $"Wall_West_{gz}", arenaRoot, new Vector3(-13.0f, 0f, gz * 2.0f), Quaternion.Euler(0f, 90f, 0f), new Vector3(1.05f, 1.15f, 1.0f), primaryWallColor, true, new Vector3(3.8f, 3.2f, 0.6f));
                // East Perimeter
                SpawnModel("Wall_Astra", $"Wall_East_{gz}", arenaRoot, new Vector3(13.0f, 0f, gz * 2.0f), Quaternion.Euler(0f, -90f, 0f), new Vector3(1.05f, 1.15f, 1.0f), primaryWallColor, true, new Vector3(3.8f, 3.2f, 0.6f));
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
                Color colTint = (i == 4) ? ColSignalOrange : ColCarbon;
                SpawnModel(colModel, $"Column_{i}", arenaRoot, columnPositions[i], Quaternion.identity, new Vector3(1.1f, 1.15f, 1.1f), colTint, true, new Vector3(1.2f, 3.2f, 1.2f));
            }

            // 4. THROW-APERTURE WINDOW DIVIDERS (Separating West Cryo Lab, Center Hub & East Reactor Bay)
            // Bodies are blocked at ground level, but thrown Data Cores fly straight through the window aperture!
            float[] dividerZ = new float[] { -2.2f, 0.2f };
            for (int i = 0; i < dividerZ.Length; i++)
            {
                // West Lab Throw Window (x = -5.5)
                SpawnModel("Wall_ShortAperture", $"Wall_ThrowWindow_W_{i}", arenaRoot, new Vector3(-5.5f, 0f, dividerZ[i]), Quaternion.Euler(0f, 90f, 0f), new Vector3(1.0f, 0.85f, 1.0f), ColBoneWhite, true, new Vector3(2.2f, 1.15f, 0.5f));
                // East Bay Throw Window (x = +5.5)
                SpawnModel("Wall_ShortAperture", $"Wall_ThrowWindow_E_{i}", arenaRoot, new Vector3(5.5f, 0f, dividerZ[i]), Quaternion.Euler(0f, -90f, 0f), new Vector3(1.0f, 0.85f, 1.0f), ColBoneWhite, true, new Vector3(2.2f, 1.15f, 0.5f));
            }

            // North Overdrive Vault Bulkhead Walls (Flanking the Central Laser Gate at z = 6.2)
            SpawnModel("Wall_Window", "Wall_Overdrive_Left", arenaRoot, new Vector3(-3.2f, 0f, 6.2f), Quaternion.identity, new Vector3(1.0f, 1.1f, 1.0f), ColCarbon, true, new Vector3(2.6f, 3.0f, 0.6f));
            SpawnModel("Wall_Window", "Wall_Overdrive_Right", arenaRoot, new Vector3(3.2f, 0f, 6.2f), Quaternion.identity, new Vector3(1.0f, 1.1f, 1.0f), ColCarbon, true, new Vector3(2.6f, 3.0f, 0.6f));

            // 5. PRESSURE PAD -> LASER GATE CIRCUITS
            CreatePressurePad(arenaRoot, pads, "Pad_Alpha", new Vector3(-8.8f, 0.05f, -1.2f));
            CreatePressurePad(arenaRoot, pads, "Pad_Beta", new Vector3(8.8f, 0.05f, -1.2f));

            // North Overdrive Laser Gate (z = 6.2, x = 0) + Wing Shortcut Gates
            CreateLaserGate(arenaRoot, gates, "Gate_North_Overdrive", new Vector3(0f, 0f, 6.2f), Quaternion.identity);
            CreateLaserGate(arenaRoot, gates, "Gate_West_Shortcut", new Vector3(-5.5f, 0f, 3.2f), Quaternion.Euler(0f, 90f, 0f));
            CreateLaserGate(arenaRoot, gates, "Gate_East_Shortcut", new Vector3(5.5f, 0f, 3.2f), Quaternion.Euler(0f, 90f, 0f));

            // 6. SHARED-COOLDOWN PHASE VENTS (Fast Corner-to-Spawn Escape Chutes)
            CreatePhaseVent(arenaRoot, vents, "Vent_West", new Vector3(-10.2f, 0.05f, -5.2f), new Vector3(-2.5f, 0f, -6.8f));
            CreatePhaseVent(arenaRoot, vents, "Vent_East", new Vector3(10.2f, 0.05f, -5.2f), new Vector3(2.5f, 0f, -6.8f));

            // 7. DATA CORES & NORTH OVERDRIVE CORE (Real Quaternius Prop_ItemHolder + Core_Tube / Core_Chest)
            CreateDataCore(arenaRoot, cores, 0, "CORE W-1", 150, new Vector3(-8.8f, 0f, 2.2f), false);
            CreateDataCore(arenaRoot, cores, 1, "CORE W-2", 120, new Vector3(-10.2f, 0f, -2.8f), false);
            CreateDataCore(arenaRoot, cores, 2, "CORE E-1", 150, new Vector3(8.8f, 0f, 2.2f), false);
            CreateDataCore(arenaRoot, cores, 3, "CORE E-2", 120, new Vector3(10.2f, 0f, -2.8f), false);
            CreateDataCore(arenaRoot, cores, 4, "HUB CORE", 160, new Vector3(0f, 0f, 2.6f), false);
            CreateDataCore(arenaRoot, cores, 5, "OVERDRIVE CORE", 350, new Vector3(0f, 0f, 8.8f), true);

            // 8. DETERMINISTIC 7.5-SECOND PATROL MECH-DRONES (Real Quaternius Enemy_QuadShell & Enemy_EyeDrone)
            CreateMechDrone(arenaRoot, drones, 0, "Enemy_QuadShell", new Vector3(-2.6f, 0.1f, -1.8f), 2.4f, 0f);
            CreateMechDrone(arenaRoot, drones, 1, "Enemy_EyeDrone", new Vector3(2.6f, 0.9f, 1.8f), 2.4f, Mathf.PI);

            // Industrial Lab Props (Crates & Barrels for visual richness in outer bays)
            SpawnModel("Prop_Crate", "LabCrate_W", arenaRoot, new Vector3(-11.2f, 0f, 4.5f), Quaternion.Euler(0f, 25f, 0f), Vector3.one, ColWarmPutty, false);
            SpawnModel("Prop_Barrel", "LabBarrel_E", arenaRoot, new Vector3(11.2f, 0f, 4.5f), Quaternion.identity, Vector3.one, ColSignalOrange, false);
        }

        private static void CreatePressurePad(Transform root, List<PressurePadNode> pads, string id, Vector3 pos)
        {
            GameObject padObj = SpawnModel("Prop_AccessPoint", id, root, pos, Quaternion.identity, new Vector3(1.25f, 0.6f, 1.25f), ColSignalOrange, false);
            GameObject ring = SpawnModel("Floor_Round", id + "_Base", padObj.transform, Vector3.zero, Quaternion.identity, new Vector3(0.95f, 0.3f, 0.95f), ColAcidVolt, false);
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
            GameObject frameObj = SpawnModel("Door_Frame", id + "_Frame", root, pos, rot, new Vector3(1.1f, 1.1f, 1.1f), ColCarbon, false);
            GameObject doorObj = SpawnModel("Door_Gate", id + "_LaserBarrier", frameObj.transform, Vector3.zero, Quaternion.identity, new Vector3(1.0f, 1.0f, 0.35f), ColInfraredRed, false);
            ApplyIndustrialMaterial(doorObj, ColInfraredRed, 1.2f);

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
            GameObject ventObj = SpawnModel("Prop_Vent", id, root, pos, Quaternion.identity, new Vector3(1.2f, 0.5f, 1.2f), ColAcidVolt, false);
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
            Vector3 coreScale = isOverdrive ? Vector3.one * 0.95f : Vector3.one * 1.45f;

            GameObject coreMesh = SpawnModel(coreModel, $"DataCore_{id}", root, pos + Vector3.up * 0.95f, Quaternion.identity, coreScale, coreColor, false);
            ApplyIndustrialMaterial(coreMesh, coreColor, 0.85f);

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
            GameObject droneObj = SpawnModel(modelName, $"MechDrone_{id}", root, pivot, Quaternion.identity, Vector3.one * 0.85f, ColInfraredRed, false);
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
