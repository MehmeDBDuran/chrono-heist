using System;
using System.Collections.Generic;
using UnityEngine;

namespace ChronoHeist
{
    [Serializable]
    public struct EchoFrameSnapshot
    {
        public float t;
        public float x;
        public float z;
        public float yaw;
        public int anim; // 0=Idle, 1=Run, 2=Carry, 3=Dash, 4=Gadget, 5=Knockback
        public int carriedCoreId;
        public int thrownCoreId;
        public float throwDirX;
        public float throwDirZ;
    }

    [Serializable]
    public class LoopTimelineData
    {
        public int loopIndex;
        public string rigClass = "infiltrator";
        public List<EchoFrameSnapshot> frames = new List<EchoFrameSnapshot>();
    }

    [Serializable]
    public class FullHeistRecording
    {
        public string skinId = "skin_standard";
        public string weaponId = "weapon_baton";
        public string shaderId = "shader_cyan";
        public List<LoopTimelineData> loops = new List<LoopTimelineData>();
    }

    public class EchoActorInstance
    {
        public int ActorId; // 1..4 Allied, 101..104 Rival
        public bool IsRival;
        public int LoopIndex;
        public string RigClass;
        public GameObject RootObj;
        public Animator CharAnimator;
        public LineRenderer GuardArcRenderer;
        public LineRenderer FloorTrailRenderer;
        public List<EchoFrameSnapshot> Frames;
        public bool IsShattered;
        public float StunTimer;
        public int CarriedCoreId = -1;
        public int LastProcessedFrameIndex = -1;
    }

    public class ChronoGameManager : MonoBehaviour
    {
        public static ChronoGameManager Instance { get; private set; }

        private Transform _arenaRoot;
        private ChronoCameraRig _cameraRig;

        private readonly List<PressurePadNode> _pads = new List<PressurePadNode>();
        private readonly List<LaserGateNode> _gates = new List<LaserGateNode>();
        private readonly List<DataCoreNode> _cores = new List<DataCoreNode>();
        private readonly List<MechDroneNode> _drones = new List<MechDroneNode>();
        private readonly List<PhaseVentNode> _vents = new List<PhaseVentNode>();
        private readonly List<Transform> _spawnPods = new List<Transform>();

        // 4 Cryo Pod Turntable Preview Actors (visible in Lobby / Armory)
        private readonly List<GameObject> _turntableOperatives = new List<GameObject>();

        // Active Player Operative
        private GameObject _playerObj;
        private Animator _playerAnimator;
        private LineRenderer _tetherLine;
        private Vector3 _playerPos;
        private float _playerYaw;
        private Vector3 _moveDir = Vector3.forward;
        private int _playerCarriedCoreId = -1;
        private float _dashCooldown = 0f;
        private float _dashActiveTimer = 0f;
        private float _gadgetCooldown = 0f;
        private float _phaseBlinkTimer = 0f;
        private float _overclockTimer = 0f;
        private float _playerStunTimer = 0f;

        // Active Holo-Decoy & EMP Mine instances
        private Vector3? _activeDecoyPos;
        private float _activeDecoyTimer = 0f;
        private GameObject _activeDecoyObj;
        private Vector3? _activeMinePos;
        private GameObject _activeMineObj;

        // Crew & Cosmetics Configuration
        private string[] _playerCrewClasses = new string[] { "infiltrator", "infiltrator", "infiltrator", "infiltrator" };
        private string _equippedSkinId = "skin_standard";
        private string _equippedWeaponId = "weapon_baton";
        private string _equippedShaderId = "shader_cyan";

        // Match & Loop State
        private bool _isMatchRunning = false;
        private bool _isTutorialMode = false;
        private bool _isAnomalyMode = false;
        private string _matchMode = "contract";
        private int _currentSectorId = 1;
        private int _currentLoopIndex = 0; // 0..3 (Loops 1..4)
        private float _loopTimer = 0f;
        private const float LOOP_DURATION = 15.0f;
        private float _rewindTransitionTimer = 0f;
        private float _sampleAccum = 0f;
        private float _hudBroadcastAccum = 0f;

        // Scores & Feats
        private int _playerScore = 0;
        private int _rivalScore = 0;
        private int _rivalTargetScore = 350;
        private int _coresExtractedCount = 0;
        private int _paradoxesTriggered = 0;
        private int _alleyOopsLanded = 0;
        private string _activeMicroCue = "";
        private string _lastEventBanner = "";
        private float _eventBannerTimer = 0f;
        private bool _hasMovedInLoop1 = false;
        private bool _tutorialSlowMoTriggered = false;

        // Recorded Timelines
        private readonly List<LoopTimelineData> _alliedRecordings = new List<LoopTimelineData>();
        private LoopTimelineData _currentLoopRecording;
        private readonly List<LoopTimelineData> _rivalRecordings = new List<LoopTimelineData>();
        private readonly List<EchoActorInstance> _activeEchoes = new List<EchoActorInstance>();

        private void Awake()
        {
            Instance = this;
            Application.targetFrameRate = 60;
        }

        private void Start()
        {
            SetupLightingAndEnvironment();

            GameObject rootGo = new GameObject("ChronoCrucibleArena");
            _arenaRoot = rootGo.transform;

            if (Camera.main != null)
            {
                _cameraRig = Camera.main.GetComponent<ChronoCameraRig>();
                if (_cameraRig == null) _cameraRig = Camera.main.gameObject.AddComponent<ChronoCameraRig>();
            }

            RebuildArenaAndTurntable(1);
            WebGLBridge.NotifyReady();
            BroadcastHudState();
        }

        private void SetupLightingAndEnvironment()
        {
            // High-Key Industrial Brutalist Daylight Laboratory Lighting (Zero Dark Purple/Cyan Cliché)
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.76f, 0.75f, 0.72f, 1f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.88f, 0.86f, 0.82f, 1f);
            RenderSettings.fogStartDistance = 28f;
            RenderSettings.fogEndDistance = 62f;

            if (Camera.main != null)
            {
                Camera.main.clearFlags = CameraClearFlags.SolidColor;
                Camera.main.backgroundColor = new Color(0.88f, 0.86f, 0.82f, 1f); // Alabaster Putty Backdrop
            }

            Light[] lights = FindObjectsByType<Light>(FindObjectsSortMode.None);
            Light mainLight = lights.Length > 0 ? lights[0] : new GameObject("LabSkylight").AddComponent<Light>();
            mainLight.type = LightType.Directional;
            mainLight.color = new Color(1.0f, 0.98f, 0.94f, 1f);
            mainLight.intensity = 1.25f;
            mainLight.transform.rotation = Quaternion.Euler(52f, -32f, 0f);
            mainLight.shadows = LightShadows.Soft;
        }

        private void RebuildArenaAndTurntable(int sectorId)
        {
            _currentSectorId = sectorId;
            CyberVaultSceneBuilder.BuildVaultArena(_arenaRoot, sectorId, _pads, _gates, _cores, _drones, _vents, _spawnPods);
            RefreshTurntableCrewModels();
        }

        private void RefreshTurntableCrewModels()
        {
            for (int i = 0; i < _turntableOperatives.Count; i++)
            {
                if (_turntableOperatives[i] != null) Destroy(_turntableOperatives[i]);
            }
            _turntableOperatives.Clear();

            for (int i = 0; i < 4 && i < _spawnPods.Count; i++)
            {
                string rigClass = _playerCrewClasses[i];
                GameObject op = CreateOperativeVisual($"Turntable_L{i + 1}_{rigClass}", _spawnPods[i].position + Vector3.up * 0.08f, Quaternion.Euler(0f, 180f, 0f), rigClass, _equippedSkinId, _equippedWeaponId, false, false);
                _turntableOperatives.Add(op);
            }
        }

        private GameObject CreateOperativeVisual(
            string objName,
            Vector3 pos,
            Quaternion rot,
            string rigClass,
            string skinId,
            string weaponId,
            bool isEcho,
            bool isRival)
        {
            // Alternate between Male & Female Quaternius rigged FBX operatives based on class
            string charModel = (rigClass == "phase_phantom" || rigClass == "grav_runner")
                ? "Char_Operative_Female"
                : "Char_Operative_Male";

            Color bodyColor = GetOperativeColor(rigClass, skinId, isEcho, isRival);
            GameObject root = CyberVaultSceneBuilder.SpawnModel(charModel, objName, _arenaRoot, pos, rot, Vector3.one * 0.95f, bodyColor, false);

            if (isEcho)
            {
                CyberVaultSceneBuilder.ApplyIndustrialMaterial(root, bodyColor, isRival ? 0.95f : 0.65f);
            }

            // Attach 3D Melee Weapon from Quaternius Sci-Fi Essentials to Hand_R or torso socket
            string weaponResource = GetWeaponResourceName(weaponId);
            Transform handSocket = FindDeepChild(root.transform, "Hand_R") ?? FindDeepChild(root.transform, "hand.R") ?? root.transform;
            Color weaponColor = isRival ? CyberVaultSceneBuilder.ColInfraredRed : CyberVaultSceneBuilder.ColSignalOrange;
            GameObject weaponObj = CyberVaultSceneBuilder.SpawnModel(weaponResource, "EquippedWeapon", handSocket, Vector3.zero, Quaternion.identity, Vector3.one * 0.85f, weaponColor, false);
            if (handSocket == root.transform)
            {
                weaponObj.transform.localPosition = new Vector3(0.38f, 0.95f, 0.35f);
            }

            return root;
        }

        private Transform FindDeepChild(Transform parent, string partialName)
        {
            foreach (Transform child in parent)
            {
                if (child.name.IndexOf(partialName, StringComparison.OrdinalIgnoreCase) >= 0)
                    return child;
                Transform found = FindDeepChild(child, partialName);
                if (found != null) return found;
            }
            return null;
        }

        private Color GetOperativeColor(string rigClass, string skinId, bool isEcho, bool isRival)
        {
            if (isRival) return CyberVaultSceneBuilder.ColInfraredRed;
            if (isEcho)
            {
                if (_equippedShaderId == "shader_solar") return CyberVaultSceneBuilder.ColAmberGold;
                if (_equippedShaderId == "shader_matrix") return CyberVaultSceneBuilder.ColAcidVolt;
                return CyberVaultSceneBuilder.ColSignalOrange;
            }

            if (skinId == "skin_specops") return CyberVaultSceneBuilder.ColCarbon;
            if (skinId == "skin_hazard") return CyberVaultSceneBuilder.ColAmberGold;
            if (skinId == "skin_archon") return new Color(0.85f, 0.88f, 0.92f, 1f);
            if (skinId == "skin_sovereign") return new Color(0.95f, 0.75f, 0.12f, 1f);

            switch (rigClass)
            {
                case "tech_hacker": return CyberVaultSceneBuilder.ColAmberGold;
                case "grav_runner": return CyberVaultSceneBuilder.ColAcidVolt;
                case "phase_phantom": return CyberVaultSceneBuilder.ColBoneWhite;
                case "enforcer": return CyberVaultSceneBuilder.ColSignalOrange;
                default: return new Color(0.20f, 0.22f, 0.24f, 1f);
            }
        }

        private string GetWeaponResourceName(string weaponId)
        {
            switch (weaponId)
            {
                case "weapon_tonfa": return "Weapon_Tonfa";
                case "weapon_cleaver": return "Weapon_Cleaver";
                case "weapon_katana": return "Weapon_Katana";
                default: return "Weapon_Baton";
            }
        }

        // ====================================================================
        // BROWSER -> UNITY PUBLIC RPC METHODS (Called via SendMessage)
        // ====================================================================

        public void FocusArmorySlot(int slotIndex)
        {
            if (_cameraRig != null)
            {
                _cameraRig.IsArmoryTurntableMode = true;
                _cameraRig.FocusedPodIndex = Mathf.Clamp(slotIndex, 0, 3);
            }
            WebGLBridge.TriggerSynth("ui_click", 0.6f);
        }

        public void ConfigureCrewAndArmory(string jsonConfig)
        {
            // Expected simple pipe/comma or JSON config: l1,l2,l3,l4|skinId|weaponId|shaderId|focusedSlot
            try
            {
                if (!string.IsNullOrEmpty(jsonConfig) && jsonConfig.Contains("|"))
                {
                    string[] parts = jsonConfig.Split('|');
                    if (parts.Length >= 1)
                    {
                        string[] crew = parts[0].Split(',');
                        for (int i = 0; i < 4 && i < crew.Length; i++)
                        {
                            if (!string.IsNullOrEmpty(crew[i])) _playerCrewClasses[i] = crew[i].Trim();
                        }
                    }
                    if (parts.Length >= 2 && !string.IsNullOrEmpty(parts[1])) _equippedSkinId = parts[1].Trim();
                    if (parts.Length >= 3 && !string.IsNullOrEmpty(parts[2])) _equippedWeaponId = parts[2].Trim();
                    if (parts.Length >= 4 && !string.IsNullOrEmpty(parts[3])) _equippedShaderId = parts[3].Trim();
                    if (parts.Length >= 5 && int.TryParse(parts[4], out int slot))
                    {
                        if (_cameraRig != null) _cameraRig.FocusedPodIndex = Mathf.Clamp(slot, 0, 3);
                    }
                }
            }
            catch (Exception) { }

            if (!_isMatchRunning)
            {
                RefreshTurntableCrewModels();
            }
        }

        public void CycleCameraFromUI()
        {
            if (_cameraRig != null)
            {
                _cameraRig.CycleCameraMode();
                BroadcastHudState();
            }
        }

        public void ReturnToArmoryLobby()
        {
            _isMatchRunning = false;
            Time.timeScale = 1.0f;
            if (_cameraRig != null)
            {
                _cameraRig.IsArmoryTurntableMode = true;
            }
            ClearActiveMatchActors();
            RebuildArenaAndTurntable(_currentSectorId);
            BroadcastHudState();
        }

        public void StartHeistMatch(string configStr)
        {
            // Format: mode|sectorId|targetScore|isTutorial|isAnomaly
            _matchMode = "contract";
            int sectorId = 1;
            _rivalTargetScore = 400;
            _isTutorialMode = false;
            _isAnomalyMode = false;

            if (!string.IsNullOrEmpty(configStr))
            {
                string[] parts = configStr.Split('|');
                if (parts.Length >= 1 && !string.IsNullOrEmpty(parts[0])) _matchMode = parts[0];
                if (parts.Length >= 2 && int.TryParse(parts[1], out int s)) sectorId = Mathf.Clamp(s, 1, 3);
                if (parts.Length >= 3 && int.TryParse(parts[2], out int t)) _rivalTargetScore = Mathf.Max(100, t);
                if (parts.Length >= 4) _isTutorialMode = (parts[3] == "1" || parts[3].Equals("true", StringComparison.OrdinalIgnoreCase));
                if (parts.Length >= 5) _isAnomalyMode = (parts[4] == "1" || parts[4].Equals("true", StringComparison.OrdinalIgnoreCase));
            }

            Time.timeScale = 1.0f;
            RebuildArenaAndTurntable(sectorId);

            // Hide turntable preview operatives during live match
            for (int i = 0; i < _turntableOperatives.Count; i++)
            {
                if (_turntableOperatives[i] != null) _turntableOperatives[i].SetActive(false);
            }

            _alliedRecordings.Clear();
            BuildRivalSyntheticTimelines();

            _playerScore = 0;
            _rivalScore = 0;
            _coresExtractedCount = 0;
            _paradoxesTriggered = 0;
            _alleyOopsLanded = 0;
            _currentLoopIndex = 0;
            _hasMovedInLoop1 = false;

            if (_cameraRig != null)
            {
                _cameraRig.IsArmoryTurntableMode = false;
            }

            BeginLoop(0);
            _isMatchRunning = true;
            WebGLBridge.TriggerSynth("match_deploy", 1.0f);
        }

        private void BuildRivalSyntheticTimelines()
        {
            _rivalRecordings.Clear();

            if (_isTutorialMode)
            {
                // In Sector 00 Tutorial:
                // Loop 1 & Loop 2 have zero rivals (focus on Pad Alpha + Throw Window + Alley-Oop Catch)
                // Loop 3 spawns 1 Rival Carrier in Center Hub to teach Backstab ([SPACE])
                // Loop 4 spawns 1 Rival Pad-Holder on Pad Beta + 1 Rival Overdrive Runner to teach Causal Laser Wipeout!
                for (int r = 0; r < 2; r++)
                {
                    LoopTimelineData tl = new LoopTimelineData { loopIndex = r, rigClass = "infiltrator" };
                    for (int f = 0; f <= 300; f++)
                    {
                        float t = f * 0.05f;
                        Vector3 pos;
                        float yaw = 0f;
                        int carried = -1;
                        if (r == 0)
                        {
                            // Rival A stands on Pad Beta (8.8, -1.2) facing East so player can easily flank or knock off pad!
                            pos = Vector3.Lerp(new Vector3(4.0f, 0f, -6.5f), new Vector3(8.8f, 0f, -1.2f), Mathf.Clamp01(t / 3.0f));
                            yaw = 90f;
                            if (t >= 3.5f && t <= 11.5f) carried = 4;
                        }
                        else
                        {
                            // Rival B runs up Center Hub through North Laser Gate (0, 6.2) at t = 6.5s!
                            if (t < 6.5f)
                                pos = Vector3.Lerp(new Vector3(2.0f, 0f, -6.0f), new Vector3(0f, 0f, 8.8f), t / 6.5f);
                            else
                                pos = Vector3.Lerp(new Vector3(0f, 0f, 8.8f), new Vector3(0f, 0f, -8.2f), (t - 6.5f) / 7.5f);
                            yaw = t < 6.5f ? 0f : 180f;
                            carried = t >= 5.5f ? 5 : -1;
                        }
                        tl.frames.Add(new EchoFrameSnapshot { t = t, x = pos.x, z = pos.z, yaw = yaw, anim = 1, carriedCoreId = carried, thrownCoreId = -1 });
                    }
                    _rivalRecordings.Add(tl);
                }
                return;
            }

            // Standard 4-Loop Rival Crew Routes (West Pad Holder, North Overdrive Runner, East Runner, Center Enforcer)
            for (int r = 0; r < 4; r++)
            {
                LoopTimelineData tl = new LoopTimelineData { loopIndex = r, rigClass = r == 3 ? "enforcer" : "infiltrator" };
                for (int f = 0; f <= 300; f++)
                {
                    float t = f * 0.05f;
                    Vector3 pos;
                    float yaw;
                    int carried = -1;

                    if (r == 0)
                    {
                        // Rival Loop 1: Sprints to Pad Beta (8.8, -1.2) to hold North Laser Gate open, then grabs Core E-2
                        if (t < 3.2f)
                            pos = Vector3.Lerp(new Vector3(3.5f, 0f, -7.8f), new Vector3(8.8f, 0f, -1.2f), t / 3.2f);
                        else if (t < 9.5f)
                            pos = new Vector3(8.8f, 0f, -1.2f);
                        else
                            pos = Vector3.Lerp(new Vector3(8.8f, 0f, -1.2f), new Vector3(0f, 0f, -8.2f), (t - 9.5f) / 5.0f);
                        yaw = t < 9.5f ? 90f : 210f;
                        if (t > 8.5f && t < 14.2f) carried = 3;
                    }
                    else if (r == 1)
                    {
                        // Rival Loop 2: Sprints straight up Center Hub through North Laser Gate (0, 6.2) to grab Overdrive Core (5)!
                        if (t < 6.2f)
                            pos = Vector3.Lerp(new Vector3(1.2f, 0f, -7.8f), new Vector3(0f, 0f, 8.8f), t / 6.2f);
                        else
                            pos = Vector3.Lerp(new Vector3(0f, 0f, 8.8f), new Vector3(0f, 0f, -8.2f), (t - 6.2f) / 7.8f);
                        yaw = t < 6.2f ? 0f : 180f;
                        if (t >= 6.0f && t < 14.0f) carried = 5;
                    }
                    else if (r == 2)
                    {
                        // Rival Loop 3: Raids West Wing Core W-1 (-8.8, 2.2)
                        if (t < 5.5f)
                            pos = Vector3.Lerp(new Vector3(-1.5f, 0f, -7.8f), new Vector3(-8.8f, 0f, 2.2f), t / 5.5f);
                        else
                            pos = Vector3.Lerp(new Vector3(-8.8f, 0f, 2.2f), new Vector3(0f, 0f, -8.2f), (t - 5.5f) / 8.5f);
                        yaw = t < 5.5f ? -35f : 145f;
                        if (t >= 5.5f && t < 14.0f) carried = 0;
                    }
                    else
                    {
                        // Rival Loop 4: Enforcer patrolling Center Hub
                        float ang = t * 1.1f;
                        pos = new Vector3(Mathf.Sin(ang) * 3.8f, 0f, Mathf.Cos(ang) * 3.2f);
                        yaw = (ang * Mathf.Rad2Deg) + 90f;
                        if (t >= 4.0f && t < 12.5f) carried = 4;
                    }

                    tl.frames.Add(new EchoFrameSnapshot
                    {
                        t = t,
                        x = pos.x,
                        z = pos.z,
                        yaw = yaw,
                        anim = 1,
                        carriedCoreId = carried,
                        thrownCoreId = -1
                    });
                }
                _rivalRecordings.Add(tl);
            }
        }

        private void ClearActiveMatchActors()
        {
            if (_playerObj != null) Destroy(_playerObj);
            if (_activeDecoyObj != null) Destroy(_activeDecoyObj);
            if (_activeMineObj != null) Destroy(_activeMineObj);
            for (int i = 0; i < _activeEchoes.Count; i++)
            {
                if (_activeEchoes[i].RootObj != null) Destroy(_activeEchoes[i].RootObj);
            }
            _activeEchoes.Clear();
        }

        private void BeginLoop(int loopIdx)
        {
            ClearActiveMatchActors();

            _currentLoopIndex = loopIdx;
            _loopTimer = 0f;
            _sampleAccum = 0f;
            _playerCarriedCoreId = -1;
            _dashCooldown = 0f;
            _dashActiveTimer = 0f;
            _gadgetCooldown = 0f;
            _phaseBlinkTimer = 0f;
            _overclockTimer = 0f;
            _playerStunTimer = 0f;
            _activeDecoyPos = null;
            _activeMinePos = null;
            _tutorialSlowMoTriggered = false;
            Time.timeScale = 1.0f;

            // Reset Cores & Gates at the start of every 15.0s Time Loop
            for (int i = 0; i < _cores.Count; i++)
            {
                DataCoreNode c = _cores[i];
                c.IsExtracted = false;
                c.IsInFlight = false;
                c.CarriedByActorId = -1;
                c.ThrownByLoopIndex = -1;
                c.CurrentPosition = c.HomePosition;
                c.Velocity = Vector3.zero;
                if (c.CoreMeshObj != null)
                {
                    c.CoreMeshObj.SetActive(true);
                    c.CoreMeshObj.transform.position = c.HomePosition;
                }
            }

            // Spawn Active Player at Pod L(loopIdx+1)
            float spawnX = -4.5f + (loopIdx * 3.0f);
            _playerPos = new Vector3(spawnX, 0f, -8.2f);
            _playerYaw = 0f;
            string currentRigClass = _playerCrewClasses[Mathf.Clamp(loopIdx, 0, 3)];

            _playerObj = CreateOperativeVisual($"Player_L{loopIdx + 1}", _playerPos, Quaternion.identity, currentRigClass, _equippedSkinId, _equippedWeaponId, false, false);
            _playerAnimator = _playerObj.GetComponentInChildren<Animator>();

            // Create spatial floor tether LineRenderer on Player
            GameObject tetherGo = new GameObject("SpatialFloorTether");
            tetherGo.transform.SetParent(_playerObj.transform);
            _tetherLine = tetherGo.AddComponent<LineRenderer>();
            _tetherLine.positionCount = 2;
            _tetherLine.startWidth = 0.14f;
            _tetherLine.endWidth = 0.08f;
            _tetherLine.material = new Material(Shader.Find("Sprites/Default"));
            _tetherLine.startColor = CyberVaultSceneBuilder.ColSignalOrange;
            _tetherLine.endColor = CyberVaultSceneBuilder.ColAcidVolt;
            _tetherLine.enabled = false;

            if (_cameraRig != null)
            {
                _cameraRig.FollowTarget = _playerObj.transform;
            }

            _currentLoopRecording = new LoopTimelineData
            {
                loopIndex = loopIdx,
                rigClass = currentRigClass
            };

            // Spawn Past Allied Echoes (Loops 0 .. loopIdx - 1)
            for (int a = 0; a < _alliedRecordings.Count; a++)
            {
                SpawnEchoActor(_alliedRecordings[a], false, a + 1);
            }

            // Spawn Rival Echoes
            int rivalCount = _isTutorialMode
                ? (loopIdx < 2 ? 0 : (loopIdx == 2 ? 1 : 2))
                : Mathf.Min(loopIdx + 1, _rivalRecordings.Count);

            for (int r = 0; r < rivalCount; r++)
            {
                SpawnEchoActor(_rivalRecordings[r], true, 101 + r);
            }

            // In Tutorial Loop 2, if player didn't throw a core in Loop 1, inject a guaranteed Allied Pass at t=4.5s so Loop 2 always teaches catching!
            if (_isTutorialMode && loopIdx == 1 && _cores.Count > 0)
            {
                ShowEventBanner("LOOP 2/4: CATCH YOUR PAST SELF'S PASS IN CENTER HUB!");
            }
            else if (loopIdx > 0)
            {
                ShowEventBanner($"LOOP {loopIdx + 1}/4 — {loopIdx} ALLIED ECHO{(loopIdx > 1 ? "ES" : "")} ACTIVE");
            }
        }

        private void SpawnEchoActor(LoopTimelineData data, bool isRival, int actorId)
        {
            if (data == null || data.frames.Count == 0) return;
            EchoFrameSnapshot f0 = data.frames[0];
            Vector3 startPos = new Vector3(f0.x, 0f, f0.z);
            Quaternion startRot = Quaternion.Euler(0f, f0.yaw, 0f);

            GameObject obj = CreateOperativeVisual(
                isRival ? $"RivalEcho_{actorId}" : $"AlliedEcho_{actorId}",
                startPos,
                startRot,
                data.rigClass,
                isRival ? "skin_specops" : _equippedSkinId,
                isRival ? "weapon_tonfa" : _equippedWeaponId,
                true,
                isRival);

            // Add directional Frontal Guard / Flank Arc indicator ring on Rival Echoes
            LineRenderer guardArc = null;
            if (isRival)
            {
                GameObject arcGo = new GameObject("FrontalGuardArc");
                arcGo.transform.SetParent(obj.transform);
                guardArc = arcGo.AddComponent<LineRenderer>();
                guardArc.positionCount = 14;
                guardArc.startWidth = 0.11f;
                guardArc.endWidth = 0.11f;
                guardArc.material = new Material(Shader.Find("Sprites/Default"));
                guardArc.startColor = CyberVaultSceneBuilder.ColInfraredRed;
                guardArc.endColor = CyberVaultSceneBuilder.ColInfraredRed;
            }

            _activeEchoes.Add(new EchoActorInstance
            {
                ActorId = actorId,
                IsRival = isRival,
                LoopIndex = data.loopIndex,
                RigClass = data.rigClass,
                RootObj = obj,
                CharAnimator = obj.GetComponentInChildren<Animator>(),
                GuardArcRenderer = guardArc,
                Frames = data.frames,
                IsShattered = false,
                StunTimer = 0f,
                CarriedCoreId = -1,
                LastProcessedFrameIndex = -1
            });
        }

        private void ShowEventBanner(string text)
        {
            _lastEventBanner = text;
            _eventBannerTimer = 2.6f;
        }

        private void Update()
        {
            if (!_isMatchRunning) return;

            if (_eventBannerTimer > 0f)
            {
                _eventBannerTimer -= Time.unscaledDeltaTime;
            }

            if (_rewindTransitionTimer > 0f)
            {
                _rewindTransitionTimer -= Time.unscaledDeltaTime;
                if (_rewindTransitionTimer <= 0f)
                {
                    BeginLoop(_currentLoopIndex + 1);
                }
                return;
            }

            float dt = Time.deltaTime;
            _loopTimer += dt;

            UpdatePlayerInputAndPhysics(dt);
            UpdateEchoActors(dt);
            UpdatePressurePadsAndGates(dt);
            UpdateBallisticCoresAndExtraction(dt);
            UpdateMechDrones(dt);
            UpdatePhaseVents(dt);
            UpdateContextualMicroCues();

            // Record 20Hz snapshot for current loop
            _sampleAccum += dt;
            if (_sampleAccum >= 0.05f)
            {
                _sampleAccum = 0f;
                RecordPlayerFrame(-1, Vector3.zero);
            }

            // Broadcast HUD telemetry at 15Hz
            _hudBroadcastAccum += Time.unscaledDeltaTime;
            if (_hudBroadcastAccum >= 0.065f)
            {
                _hudBroadcastAccum = 0f;
                BroadcastHudState();
            }

            // Check end of 15.0s loop
            if (_loopTimer >= LOOP_DURATION)
            {
                CompleteCurrentLoop();
            }
        }

        private void UpdatePlayerInputAndPhysics(float dt)
        {
            if (_playerObj == null) return;

            if (_dashCooldown > 0f) _dashCooldown -= dt;
            if (_gadgetCooldown > 0f) _gadgetCooldown -= dt;
            if (_phaseBlinkTimer > 0f) _phaseBlinkTimer -= dt;
            if (_overclockTimer > 0f) _overclockTimer -= dt;

            if (_playerStunTimer > 0f)
            {
                _playerStunTimer -= dt;
                return;
            }

            float h = 0f;
            float v = 0f;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.Z) || Input.GetKey(KeyCode.UpArrow)) v += 1f;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) v -= 1f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) h += 1f;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.Q) && !Input.GetKeyDown(KeyCode.Q) || Input.GetKey(KeyCode.LeftArrow)) h -= 1f;

            Vector3 inputVec = new Vector3(h, 0f, v);
            if (inputVec.sqrMagnitude > 0.01f)
            {
                inputVec.Normalize();
                _moveDir = inputVec;
                _playerYaw = Mathf.Atan2(_moveDir.x, _moveDir.z) * Mathf.Rad2Deg;
                _hasMovedInLoop1 = true;
                if (_tutorialSlowMoTriggered && Time.timeScale < 0.9f) Time.timeScale = 1.0f;
            }

            if (_cameraRig != null)
            {
                _cameraRig.AimDirection = _moveDir;
            }

            // [SPACE] or Right-Click: Blade Dash / Backstab Strike
            if ((Input.GetKeyDown(KeyCode.Space) || Input.GetMouseButtonDown(1)) && _dashCooldown <= 0f)
            {
                string rig = _playerCrewClasses[_currentLoopIndex];
                _dashActiveTimer = (rig == "grav_runner") ? 0.16f : 0.22f;
                _dashCooldown = _isAnomalyMode ? 1.6f : 2.8f;
                if (_tutorialSlowMoTriggered) Time.timeScale = 1.0f;
                WebGLBridge.TriggerSynth("blade_dash", 1.0f);
                AttemptPlayerBladeStrike();
            }

            // [E] or Left-Click: Ballistic Core Throw (Temporal Alley-Oop Pass or Ricochet Shot!)
            if ((Input.GetKeyDown(KeyCode.E) || Input.GetMouseButtonDown(0)) && _playerCarriedCoreId >= 0)
            {
                ThrowCarriedCore();
            }

            // [Q] or [F]: Class Tactical Gadget
            if ((Input.GetKeyDown(KeyCode.Q) || Input.GetKeyDown(KeyCode.F)) && _gadgetCooldown <= 0f)
            {
                ActivateClassGadget();
            }

            // Compute movement speed based on Class Rig + Overdrive Surge (final 3s of loop)
            string currentRig = _playerCrewClasses[_currentLoopIndex];
            float baseSpeed = 7.2f;
            if (currentRig == "phase_phantom" && _playerCarriedCoreId < 0) baseSpeed *= 1.14f;
            if (currentRig == "enforcer" && _playerCarriedCoreId >= 0) baseSpeed *= 0.88f;
            if (_overclockTimer > 0f) baseSpeed *= 1.28f;
            if (_loopTimer >= 12.0f) baseSpeed *= 1.25f; // Final 3s Overdrive Surge!
            if (_isAnomalyMode) baseSpeed *= 1.18f;

            if (_dashActiveTimer > 0f)
            {
                _dashActiveTimer -= dt;
                baseSpeed = 21.0f;
                AttemptPlayerBladeStrike();
            }

            Vector3 velocity = (inputVec.sqrMagnitude > 0.01f || _dashActiveTimer > 0f)
                ? _moveDir * baseSpeed
                : Vector3.zero;

            Vector3 nextPos = _playerPos + velocity * dt;
            nextPos = ResolveArenaCollisions(_playerPos, nextPos, _phaseBlinkTimer > 0f);
            _playerPos = nextPos;

            _playerObj.transform.position = _playerPos;
            _playerObj.transform.rotation = Quaternion.Slerp(_playerObj.transform.rotation, Quaternion.Euler(0f, _playerYaw, 0f), dt * 18f);
        }

        private Vector3 ResolveArenaCollisions(Vector3 fromPos, Vector3 toPos, bool ignoreLaserGates)
        {
            toPos.x = Mathf.Clamp(toPos.x, -11.8f, 11.8f);
            toPos.z = Mathf.Clamp(toPos.z, -10.2f, 9.8f);

            // Center Chrono Pillar collision
            if (new Vector2(toPos.x, toPos.z).magnitude < 1.15f)
            {
                Vector2 push = new Vector2(toPos.x, toPos.z).normalized * 1.15f;
                toPos.x = push.x;
                toPos.z = push.y;
            }

            // Throw-Aperture Window Divider Walls at x = -5.5 and x = +5.5 (z between -3.5 and +1.8)
            // Operatives cannot walk through the glass slot (they must use the Southern opening or Northern Shortcut Gate),
            // whereas thrown Cores at y=1.4m sail right over them!
            if (toPos.z > -3.6f && toPos.z < 2.0f)
            {
                if (Mathf.Abs(toPos.x - (-5.5f)) < 0.55f)
                    toPos.x = fromPos.x < -5.5f ? -6.05f : -4.95f;
                if (Mathf.Abs(toPos.x - 5.5f) < 0.55f)
                    toPos.x = fromPos.x > 5.5f ? 6.05f : 4.95f;
            }

            // North Overdrive Vault Wall at z = 6.2 (opening at x in [-1.4, +1.4] controlled by Gate_North_Overdrive)
            if (Mathf.Abs(toPos.z - 6.2f) < 0.55f)
            {
                bool inDoorway = Mathf.Abs(toPos.x) < 1.35f;
                bool gateOpen = (_gates.Count > 0 && _gates[0].IsOpen) || ignoreLaserGates;
                if (!inDoorway || !gateOpen)
                {
                    toPos.z = fromPos.z < 6.2f ? 5.65f : 6.75f;
                }
            }

            return toPos;
        }

        private void AttemptPlayerBladeStrike()
        {
            for (int i = 0; i < _activeEchoes.Count; i++)
            {
                EchoActorInstance echo = _activeEchoes[i];
                if (!echo.IsRival || echo.IsShattered || echo.RootObj == null) continue;

                Vector3 echoPos = echo.RootObj.transform.position;
                float dist = Vector3.Distance(_playerPos, echoPos);
                if (dist > 2.65f) continue;

                // Check Rival Echo's Frontal Reflex Guard Cone (90 deg standard, 140 deg for Enforcer)
                Vector3 echoForward = echo.RootObj.transform.forward;
                Vector3 toPlayer = (_playerPos - echoPos).normalized;
                float angleFromFront = Vector3.Angle(echoForward, toPlayer);
                float guardHalfAngle = (echo.RigClass == "enforcer") ? 65f : 42f;

                // In Sector 00 Tutorial Loop 4, allow knocking the Pad Holder off Pad Beta from any angle
                bool isTutorialPadKnock = _isTutorialMode && _currentLoopIndex == 3;

                if (angleFromFront <= guardHalfAngle && !isTutorialPadKnock)
                {
                    // FRONTAL REFLEX PARRY! Rival Echo counters frontal slash!
                    _playerStunTimer = 0.85f;
                    _dashActiveTimer = 0f;
                    DropPlayerCore();
                    WebGLBridge.TriggerSynth("frontal_parry", 1.0f);
                    ShowEventBanner("PARRIED BY FRONTAL GUARD! FLANK BEHIND ECHO OR THROW CORE!");
                    return;
                }

                // FLANK BACKSTAB SHATTER!
                ShatterRivalEcho(echo, "PARADOX BACKSTAB SHATTER! +200 PTS", 200);
                _dashCooldown = 0f; // Instant Chain-Dash Reset on takedown!
            }
        }

        private void ShatterRivalEcho(EchoActorInstance echo, string bannerMsg, int bonusPoints)
        {
            echo.IsShattered = true;
            if (echo.CarriedCoreId >= 0 && echo.CarriedCoreId < _cores.Count)
            {
                DataCoreNode dropped = _cores[echo.CarriedCoreId];
                dropped.CarriedByActorId = -1;
                dropped.IsInFlight = true;
                dropped.CurrentPosition = echo.RootObj.transform.position + Vector3.up * 1.1f;
                dropped.Velocity = new Vector3(UnityEngine.Random.Range(-2f, 2f), 0f, -2.5f);
                echo.CarriedCoreId = -1;
            }

            if (echo.RootObj != null)
            {
                echo.RootObj.SetActive(false);
            }

            _paradoxesTriggered++;
            _playerScore += bonusPoints;
            _rivalScore = Mathf.Max(0, _rivalScore - 150);

            if (_cameraRig != null)
            {
                _cameraRig.TriggerImpactPunch(1.35f, 0.12f);
            }
            WebGLBridge.TriggerSynth("paradox_shatter", 1.0f);
            ShowEventBanner(bannerMsg);
        }

        private void DropPlayerCore()
        {
            if (_playerCarriedCoreId >= 0 && _playerCarriedCoreId < _cores.Count)
            {
                DataCoreNode c = _cores[_playerCarriedCoreId];
                c.CarriedByActorId = -1;
                c.CurrentPosition = _playerPos + Vector3.up * 0.9f;
                c.IsInFlight = false;
                _playerCarriedCoreId = -1;
            }
        }

        private void ThrowCarriedCore()
        {
            if (_playerCarriedCoreId < 0 || _playerCarriedCoreId >= _cores.Count) return;

            DataCoreNode c = _cores[_playerCarriedCoreId];
            string rig = _playerCrewClasses[_currentLoopIndex];
            float throwSpeed = 14.5f;
            if (rig == "grav_runner") throwSpeed *= 1.25f;
            if (rig == "tech_hacker") throwSpeed *= 0.85f;
            if (_isAnomalyMode) throwSpeed *= 1.35f;

            c.CarriedByActorId = -1;
            c.IsInFlight = true;
            c.ThrownByLoopIndex = _currentLoopIndex;
            c.CurrentPosition = _playerPos + _moveDir * 0.9f + Vector3.up * 1.35f;
            c.Velocity = _moveDir * throwSpeed;

            RecordPlayerFrame(_playerCarriedCoreId, _moveDir);
            _playerCarriedCoreId = -1;

            WebGLBridge.TriggerSynth("core_throw", 0.9f);
            ShowEventBanner("CORE LAUNCHED THROUGH APERTURE!");
        }

        private void ActivateClassGadget()
        {
            string rig = _playerCrewClasses[_currentLoopIndex];
            _gadgetCooldown = 6.0f;
            WebGLBridge.TriggerSynth("gadget_activate", 0.9f);

            switch (rig)
            {
                case "tech_hacker":
                    // Holo-Decoy: Spawns 3.5s weight clone at player's feet to hold Pressure Pad!
                    _activeDecoyPos = _playerPos;
                    _activeDecoyTimer = 3.5f;
                    if (_activeDecoyObj != null) Destroy(_activeDecoyObj);
                    _activeDecoyObj = CyberVaultSceneBuilder.SpawnModel("Char_Mannequin", "HoloDecoy", _arenaRoot, _playerPos, Quaternion.Euler(0f, _playerYaw, 0f), Vector3.one * 0.9f, CyberVaultSceneBuilder.ColAcidVolt, false);
                    ShowEventBanner("HOLO-DECOY DEPLOYED ON CIRCUIT (3.5s)!");
                    break;

                case "grav_runner":
                    // Kinetic Pull: Yanks nearest loose Core within 6.5m straight into hands!
                    if (_playerCarriedCoreId < 0)
                    {
                        float bestDist = 6.5f;
                        DataCoreNode bestCore = null;
                        for (int i = 0; i < _cores.Count; i++)
                        {
                            DataCoreNode c = _cores[i];
                            if (c.IsExtracted || c.CarriedByActorId >= 0) continue;
                            float d = Vector3.Distance(_playerPos, new Vector3(c.CurrentPosition.x, 0f, c.CurrentPosition.z));
                            if (d < bestDist)
                            {
                                bestDist = d;
                                bestCore = c;
                            }
                        }
                        if (bestCore != null)
                        {
                            bestCore.CarriedByActorId = 0;
                            bestCore.IsInFlight = false;
                            _playerCarriedCoreId = bestCore.Id;
                            _dashCooldown = 0f;
                            ShowEventBanner($"KINETIC PULL: YANKED {bestCore.Label}!");
                        }
                    }
                    break;

                case "phase_phantom":
                    // Phase Blink: 1.5s ghost phase through Laser Gates!
                    DropPlayerCore();
                    _phaseBlinkTimer = 1.5f;
                    ShowEventBanner("PHASE BLINK ACTIVE — DASH THROUGH LASER GATES!");
                    break;

                case "enforcer":
                    // Chrono EMP Mine: Proximity trap that stuns Rival Echoes
                    _activeMinePos = _playerPos;
                    if (_activeMineObj != null) Destroy(_activeMineObj);
                    _activeMineObj = CyberVaultSceneBuilder.SpawnModel("Gadget_Mine", "ChronoMine", _arenaRoot, _playerPos + Vector3.up * 0.1f, Quaternion.identity, Vector3.one * 1.4f, CyberVaultSceneBuilder.ColSignalOrange, false);
                    ShowEventBanner("CHRONO EMP MINE ARMED!");
                    break;

                default:
                    // Infiltrator Overclock Surge (+28% Speed for 2.5s)
                    _overclockTimer = 2.5f;
                    ShowEventBanner("OVERCLOCK SURGE (+28% SPEED)!");
                    break;
            }
        }

        private void RecordPlayerFrame(int thrownCoreId, Vector3 throwDir)
        {
            if (_currentLoopRecording == null) return;
            _currentLoopRecording.frames.Add(new EchoFrameSnapshot
            {
                t = _loopTimer,
                x = _playerPos.x,
                z = _playerPos.z,
                yaw = _playerYaw,
                anim = _dashActiveTimer > 0f ? 3 : (_playerCarriedCoreId >= 0 ? 2 : 1),
                carriedCoreId = _playerCarriedCoreId,
                thrownCoreId = thrownCoreId,
                throwDirX = throwDir.x,
                throwDirZ = throwDir.z
            });
        }

        private void UpdateEchoActors(float dt)
        {
            int frameIdx = Mathf.Clamp(Mathf.FloorToInt(_loopTimer / 0.05f), 0, 300);

            for (int i = 0; i < _activeEchoes.Count; i++)
            {
                EchoActorInstance echo = _activeEchoes[i];
                if (echo.IsShattered || echo.RootObj == null || echo.Frames == null || echo.Frames.Count == 0) continue;

                if (echo.StunTimer > 0f)
                {
                    echo.StunTimer -= dt;
                    continue;
                }

                int clampedIdx = Mathf.Min(frameIdx, echo.Frames.Count - 1);
                EchoFrameSnapshot snap = echo.Frames[clampedIdx];
                Vector3 pos = new Vector3(snap.x, 0f, snap.z);

                // Tutorial Loop 2 Guaranteed Allied Throw from Pad Alpha through West Throw Window at t = 4.2s!
                if (_isTutorialMode && _currentLoopIndex == 1 && !echo.IsRival && _loopTimer >= 4.2f && echo.LastProcessedFrameIndex < 999)
                {
                    echo.LastProcessedFrameIndex = 999;
                    DataCoreNode tutCore = _cores[0];
                    if (!tutCore.IsExtracted && tutCore.CarriedByActorId < 0)
                    {
                        tutCore.CurrentPosition = new Vector3(-6.2f, 1.35f, -1.0f);
                        tutCore.Velocity = new Vector3(9.5f, 0f, 0.2f);
                        tutCore.IsInFlight = true;
                        tutCore.ThrownByLoopIndex = 0;
                        WebGLBridge.TriggerSynth("core_throw", 0.9f);
                        ShowEventBanner("PAST YOU THREW CORE W-1 THROUGH WINDOW — CATCH IT!");
                    }
                }

                // Replay recorded Ballistic Core Throw from Allied Echo!
                if (!echo.IsRival && snap.thrownCoreId >= 0 && snap.thrownCoreId < _cores.Count && echo.LastProcessedFrameIndex != clampedIdx)
                {
                    echo.LastProcessedFrameIndex = clampedIdx;
                    DataCoreNode thrownCore = _cores[snap.thrownCoreId];
                    if (!thrownCore.IsExtracted)
                    {
                        thrownCore.CarriedByActorId = -1;
                        thrownCore.IsInFlight = true;
                        thrownCore.ThrownByLoopIndex = echo.LoopIndex;
                        thrownCore.CurrentPosition = pos + Vector3.up * 1.35f;
                        thrownCore.Velocity = new Vector3(snap.throwDirX, 0f, snap.throwDirZ).normalized * 14.5f;
                        echo.CarriedCoreId = -1;
                        WebGLBridge.TriggerSynth("core_throw", 0.8f);
                    }
                }

                // Check EMP Mine trigger on Rival Echoes
                if (echo.IsRival && _activeMinePos.HasValue && Vector3.Distance(pos, _activeMinePos.Value) < 2.2f)
                {
                    _activeMinePos = null;
                    if (_activeMineObj != null) Destroy(_activeMineObj);
                    ShatterRivalEcho(echo, "CHRONO EMP MINE DETONATION! +220 PTS", 220);
                    continue;
                }

                // CAUSAL BUTTERFLY PARADOX CHECK:
                // Did a Rival Echo sprint into the CLOSED North Overdrive Laser Gate (z = 6.2) because the player knocked their Pad-Holder off the pad?!
                if (echo.IsRival && _gates.Count > 0 && !_gates[0].IsOpen)
                {
                    if (Mathf.Abs(pos.z - 6.2f) < 0.75f && Mathf.Abs(pos.x) < 1.6f)
                    {
                        ShatterRivalEcho(echo, "CAUSAL BUTTERFLY WIPEOUT! LASER GATE VAPORIZED RIVAL (+350 PTS)", 350);
                        continue;
                    }
                }

                echo.RootObj.transform.position = pos;
                echo.RootObj.transform.rotation = Quaternion.Euler(0f, snap.yaw, 0f);

                // Update Rival Frontal Guard Arc visual
                if (echo.IsRival && echo.GuardArcRenderer != null)
                {
                    float halfAng = (echo.RigClass == "enforcer") ? 65f : 42f;
                    for (int p = 0; p < 14; p++)
                    {
                        float a = Mathf.Lerp(-halfAng, halfAng, p / 13f) * Mathf.Deg2Rad;
                        Vector3 localDir = new Vector3(Mathf.Sin(a), 0.08f, Mathf.Cos(a)) * 1.65f;
                        echo.GuardArcRenderer.SetPosition(p, echo.RootObj.transform.TransformPoint(localDir));
                    }
                }

                // Rival Echo Core Pickup & Extraction (Temporal Loot Rules A & B)
                if (echo.IsRival && snap.carriedCoreId >= 0 && snap.carriedCoreId < _cores.Count && echo.CarriedCoreId < 0)
                {
                    DataCoreNode targetCore = _cores[snap.carriedCoreId];
                    if (!targetCore.IsExtracted && targetCore.CarriedByActorId < 0 && !targetCore.IsInFlight)
                    {
                        if (Vector3.Distance(pos, new Vector3(targetCore.CurrentPosition.x, 0f, targetCore.CurrentPosition.z)) < 2.8f)
                        {
                            targetCore.CarriedByActorId = echo.ActorId;
                            echo.CarriedCoreId = targetCore.Id;
                        }
                    }
                    else if (targetCore.CarriedByActorId == 0 || targetCore.IsExtracted)
                    {
                        // Rule A: Pre-emptive Temporal Snatch! Player took the core before Rival arrived -> Rival suffers Desync Stun!
                        echo.StunTimer = 1.5f;
                        ShowEventBanner("TEMPORAL SNATCH! RIVAL ECHO DESYNCED AT EMPTY PEDESTAL!");
                    }
                }

                // Bank Rival Core if Rival reaches South Extraction Deck unharmed
                if (echo.IsRival && echo.CarriedCoreId >= 0 && Vector3.Distance(pos, new Vector3(0f, 0f, -8.2f)) < 2.5f)
                {
                    DataCoreNode banked = _cores[echo.CarriedCoreId];
                    banked.IsExtracted = true;
                    banked.CarriedByActorId = -1;
                    if (banked.CoreMeshObj != null) banked.CoreMeshObj.SetActive(false);
                    _rivalScore += banked.BasePoints;
                    echo.CarriedCoreId = -1;
                }
            }
        }

        private void UpdatePressurePadsAndGates(float dt)
        {
            if (_activeDecoyTimer > 0f)
            {
                _activeDecoyTimer -= dt;
                if (_activeDecoyTimer <= 0f)
                {
                    _activeDecoyPos = null;
                    if (_activeDecoyObj != null) Destroy(_activeDecoyObj);
                }
            }

            bool anyPadActive = false;

            for (int i = 0; i < _pads.Count; i++)
            {
                PressurePadNode pad = _pads[i];
                bool steppedOn = false;
                float holdDuration = _isAnomalyMode ? 3.8f : 2.0f;

                // Check Player
                if (Vector3.Distance(_playerPos, pad.Position) < 1.85f)
                {
                    steppedOn = true;
                    if (_playerCrewClasses[_currentLoopIndex] == "tech_hacker") holdDuration = 4.2f;
                }

                // Check Holo-Decoy
                if (_activeDecoyPos.HasValue && Vector3.Distance(_activeDecoyPos.Value, pad.Position) < 1.85f)
                {
                    steppedOn = true;
                    holdDuration = 3.5f;
                }

                // Check Allied & Rival Echoes
                for (int e = 0; e < _activeEchoes.Count; e++)
                {
                    EchoActorInstance echo = _activeEchoes[e];
                    if (echo.IsShattered || echo.RootObj == null) continue;
                    if (Vector3.Distance(echo.RootObj.transform.position, pad.Position) < 1.85f)
                    {
                        steppedOn = true;
                        if (echo.RigClass == "tech_hacker") holdDuration = 4.2f;
                    }
                }

                if (steppedOn)
                {
                    if (pad.CapacitorHoldTimer <= 0.1f)
                    {
                        WebGLBridge.TriggerSynth("pad_engaged", 0.7f);
                    }
                    pad.CapacitorHoldTimer = holdDuration;
                }
                else if (pad.CapacitorHoldTimer > 0f)
                {
                    pad.CapacitorHoldTimer -= dt;
                }

                if (pad.IndicatorRenderer != null && pad.IndicatorRenderer.material != null)
                {
                    pad.IndicatorRenderer.material.color = pad.IsActive
                        ? CyberVaultSceneBuilder.ColAcidVolt
                        : CyberVaultSceneBuilder.ColSignalOrange;
                }

                if (pad.IsActive) anyPadActive = true;
            }

            // Update Laser Gates
            for (int g = 0; g < _gates.Count; g++)
            {
                LaserGateNode gate = _gates[g];
                gate.IsOpen = anyPadActive;
                gate.OpenBlend = Mathf.MoveTowards(gate.OpenBlend, gate.IsOpen ? 1f : 0f, dt * 4.5f);
                if (gate.GateDoorObj != null)
                {
                    gate.GateDoorObj.transform.localPosition = new Vector3(0f, -gate.OpenBlend * 2.75f, 0f);
                }
                if (gate.BlockingCollider != null)
                {
                    gate.BlockingCollider.enabled = !gate.IsOpen;
                }
            }
        }

        private void UpdateBallisticCoresAndExtraction(float dt)
        {
            string currentRig = _playerCrewClasses[_currentLoopIndex];
            float catchRadius = (currentRig == "grav_runner") ? 2.85f : 1.55f;

            for (int i = 0; i < _cores.Count; i++)
            {
                DataCoreNode c = _cores[i];
                if (c.IsExtracted || c.CoreMeshObj == null) continue;

                if (c.IsInFlight)
                {
                    Vector3 next = c.CurrentPosition + c.Velocity * dt;

                    // Ricochet bounce off outer perimeter walls!
                    if (Mathf.Abs(next.x) > 11.4f)
                    {
                        c.Velocity.x = -c.Velocity.x * 0.85f;
                        next.x = Mathf.Sign(next.x) * 11.4f;
                        WebGLBridge.TriggerSynth("core_ricochet", 0.7f);
                    }
                    if (Mathf.Abs(next.z) > 9.4f)
                    {
                        c.Velocity.z = -c.Velocity.z * 0.85f;
                        next.z = Mathf.Sign(next.z) * 9.4f;
                        WebGLBridge.TriggerSynth("core_ricochet", 0.7f);
                    }

                    c.CurrentPosition = next;
                    c.Velocity = Vector3.MoveTowards(c.Velocity, Vector3.zero, dt * 6.5f);

                    // Check if thrown Core ricochets into a Rival Echo! (Core Ricochet Knockdown!)
                    for (int e = 0; e < _activeEchoes.Count; e++)
                    {
                        EchoActorInstance echo = _activeEchoes[e];
                        if (!echo.IsRival || echo.IsShattered || echo.RootObj == null) continue;
                        if (Vector3.Distance(new Vector3(c.CurrentPosition.x, 0f, c.CurrentPosition.z), echo.RootObj.transform.position) < 1.6f)
                        {
                            ShatterRivalEcho(echo, "CORE RICOCHET TAKEDOWN! +250 PTS", 250);
                            c.Velocity = -c.Velocity * 0.5f;
                            break;
                        }
                    }

                    if (c.Velocity.sqrMagnitude < 0.25f)
                    {
                        c.IsInFlight = false;
                        c.CurrentPosition.y = 0.95f;
                    }
                }

                // Check Player Pickup / Temporal Alley-Oop Catch!
                if (_playerCarriedCoreId < 0 && c.CarriedByActorId < 0)
                {
                    float distToPlayer = Vector3.Distance(_playerPos, new Vector3(c.CurrentPosition.x, 0f, c.CurrentPosition.z));
                    if (distToPlayer <= catchRadius)
                    {
                        bool isCrossLoopAlleyOop = (c.ThrownByLoopIndex >= 0 && c.ThrownByLoopIndex != _currentLoopIndex);
                        c.CarriedByActorId = 0;
                        c.IsInFlight = false;
                        _playerCarriedCoreId = c.Id;

                        if (isCrossLoopAlleyOop)
                        {
                            _alleyOopsLanded++;
                            _playerScore += 250;
                            _dashCooldown = 0f; // Instant Dash Reset on Alley-Oop catch!
                            if (_cameraRig != null) _cameraRig.TriggerImpactPunch(1.1f, 0.09f);
                            WebGLBridge.TriggerSynth("alley_oop_catch", 1.0f);
                            ShowEventBanner("2X TEMPORAL ALLEY-OOP CATCH! (+250 BONUS PTS)");
                        }
                        else
                        {
                            WebGLBridge.TriggerSynth("core_pickup", 0.8f);
                        }
                    }
                }

                // Update Core 3D position
                if (c.CarriedByActorId == 0)
                {
                    c.CurrentPosition = _playerPos + Vector3.up * 1.85f;
                }
                else if (c.CarriedByActorId > 0)
                {
                    for (int e = 0; e < _activeEchoes.Count; e++)
                    {
                        if (_activeEchoes[e].ActorId == c.CarriedByActorId && _activeEchoes[e].RootObj != null)
                        {
                            c.CurrentPosition = _activeEchoes[e].RootObj.transform.position + Vector3.up * 1.85f;
                            break;
                        }
                    }
                }

                c.CoreMeshObj.transform.position = c.CurrentPosition;
                c.CoreMeshObj.transform.Rotate(Vector3.up, dt * 110f, Space.World);
            }

            // Check Player Extraction at South Extraction Ring (0, -8.2)
            if (_playerCarriedCoreId >= 0 && Vector3.Distance(_playerPos, new Vector3(0f, 0f, -8.2f)) < 2.6f)
            {
                DataCoreNode extracted = _cores[_playerCarriedCoreId];
                extracted.IsExtracted = true;
                extracted.CarriedByActorId = -1;
                if (extracted.CoreMeshObj != null) extracted.CoreMeshObj.SetActive(false);

                _playerScore += extracted.BasePoints;
                _coresExtractedCount++;
                _playerCarriedCoreId = -1;
                WebGLBridge.TriggerSynth("core_extract", 1.0f);
                ShowEventBanner($"EXTRACTED {extracted.Label} (+{extracted.BasePoints} PTS)!");
            }

            // Update Spatial Floor Tether Line (Connects Operative directly to Extraction Ring or Throw Window)
            if (_tetherLine != null)
            {
                if (_playerCarriedCoreId >= 0)
                {
                    _tetherLine.enabled = true;
                    _tetherLine.SetPosition(0, _playerPos + Vector3.up * 0.15f);
                    // In Tutorial Loop 1, point tether to West Throw Window (-5.5, -1.0) to teach throwing through glass!
                    Vector3 tetherTarget = (_isTutorialMode && _currentLoopIndex == 0)
                        ? new Vector3(-5.5f, 0.8f, -1.0f)
                        : new Vector3(0f, 0.15f, -8.2f);
                    _tetherLine.SetPosition(1, tetherTarget);
                }
                else
                {
                    _tetherLine.enabled = false;
                }
            }
        }

        private void UpdateMechDrones(float dt)
        {
            // Strict 7.5-second cycle (2 full 360° orbits per 15.0s loop)
            float phaseAngle = (_loopTimer / 7.5f) * Mathf.PI * 2f;

            for (int i = 0; i < _drones.Count; i++)
            {
                MechDroneNode d = _drones[i];
                if (d.DroneObj == null) continue;

                float ang = phaseAngle + d.PhaseOffset;
                Vector3 nextPos = d.CenterPivot + new Vector3(Mathf.Cos(ang) * d.OrbitRadius, 0f, Mathf.Sin(ang) * d.OrbitRadius);
                Vector3 dir = (nextPos - d.CurrentPosition).normalized;
                d.CurrentPosition = nextPos;
                if (dir.sqrMagnitude > 0.001f) d.ForwardDir = dir;

                d.DroneObj.transform.position = d.CurrentPosition;
                d.DroneObj.transform.rotation = Quaternion.LookRotation(d.ForwardDir, Vector3.up);
            }
        }

        private void UpdatePhaseVents(float dt)
        {
            for (int i = 0; i < _vents.Count; i++)
            {
                PhaseVentNode v = _vents[i];
                if (v.CooldownTimer > 0f)
                {
                    v.CooldownTimer -= dt;
                    continue;
                }

                if (Vector3.Distance(_playerPos, v.Position) < 1.45f)
                {
                    _playerPos = v.ExitPosition;
                    v.CooldownTimer = 4.0f;
                    WebGLBridge.TriggerSynth("phase_vent", 0.85f);
                    ShowEventBanner("PHASE VENT LAUNCH TO EXTRACTION DECK!");
                }
            }
        }

        private void UpdateContextualMicroCues()
        {
            if (_isTutorialMode)
            {
                if (_currentLoopIndex == 0)
                {
                    if (_playerCarriedCoreId < 0)
                        _activeMicroCue = "LOOP 1/4: STEP ON PAD ALPHA (WEST) & GRAB CORE W-1";
                    else
                        _activeMicroCue = "AIM AT THROW WINDOW & PRESS [E] TO PASS CORE TO FUTURE YOU!";
                }
                else if (_currentLoopIndex == 1)
                {
                    _activeMicroCue = "LOOP 2/4: CATCH YOUR LOOP 1 PASS IN CENTER HUB & RUN TO SOUTH RING!";
                }
                else if (_currentLoopIndex == 2)
                {
                    _activeMicroCue = "LOOP 3/4: FLANK BEHIND CRIMSON ECHO & PRESS [SPACE] TO BACKSTAB!";
                    // Trigger 0.25x Tactical Slow-Mo when behind Rival Echo in Tutorial Loop 3!
                    if (!_tutorialSlowMoTriggered && _activeEchoes.Count > 0)
                    {
                        for (int i = 0; i < _activeEchoes.Count; i++)
                        {
                            if (_activeEchoes[i].IsRival && !_activeEchoes[i].IsShattered && _activeEchoes[i].RootObj != null)
                            {
                                float d = Vector3.Distance(_playerPos, _activeEchoes[i].RootObj.transform.position);
                                if (d < 3.4f)
                                {
                                    _tutorialSlowMoTriggered = true;
                                    Time.timeScale = 0.25f;
                                }
                            }
                        }
                    }
                }
                else
                {
                    _activeMicroCue = "LOOP 4/4: [SPACE] SLASH RIVAL ON EAST PAD BETA TO SLAM LASER GATE ON RUNNER!";
                }
                return;
            }

            if (_currentLoopIndex == 0 && !_hasMovedInLoop1)
            {
                _activeMicroCue = "[WASD] MOVE  •  [SPACE] BACKSTAB DASH  •  [E] THROW CORE  •  [Q] GADGET";
            }
            else if (_playerCarriedCoreId >= 0)
            {
                _activeMicroCue = "CARRYING CORE — [E] THROW ALLEY-OOP PASS OR EXTRACT AT SOUTH RING";
            }
            else
            {
                _activeMicroCue = "";
            }
        }

        private void CompleteCurrentLoop()
        {
            Time.timeScale = 1.0f;
            _alliedRecordings.Add(_currentLoopRecording);

            if (_currentLoopIndex < 3)
            {
                // Rewind to next loop!
                _rewindTransitionTimer = 0.65f;
                if (_cameraRig != null) _cameraRig.TriggerRewindSweep();
                WebGLBridge.TriggerSynth("loop_rewind", 1.0f);
                BroadcastHudState();
            }
            else
            {
                // All 4 Loops Completed -> Finish Match!
                _isMatchRunning = false;
                WebGLBridge.TriggerSynth("match_complete", 1.0f);
                BroadcastHudState();

                string resultJson = string.Format(
                    "{{\"score\":{0},\"rivalScore\":{1},\"coresExtracted\":{2},\"paradoxes\":{3},\"alleyOops\":{4},\"isTutorial\":{5}}}",
                    _playerScore,
                    Mathf.Max(_rivalScore, _rivalTargetScore),
                    _coresExtractedCount,
                    _paradoxesTriggered,
                    _alleyOopsLanded,
                    _isTutorialMode ? "true" : "false"
                );
                WebGLBridge.SendMatchComplete(resultJson);
            }
        }

        private void BroadcastHudState()
        {
            string camLabel = _cameraRig != null ? _cameraRig.GetModeLabel() : "TACTICAL 46°";
            string rigClass = _playerCrewClasses[Mathf.Clamp(_currentLoopIndex, 0, 3)];
            string banner = _eventBannerTimer > 0f ? EscapeJson(_lastEventBanner) : "";
            string cue = EscapeJson(_activeMicroCue);

            string json = string.Format(
                "{{\"isRunning\":{0},\"isRewinding\":{1},\"isTutorial\":{2},\"loop\":{3},\"timeLeft\":{4:F1},\"playerScore\":{5},\"rivalScore\":{6},\"carryingCore\":{7},\"dashReady\":{8},\"gadgetReady\":{9},\"cameraMode\":\"{10}\",\"rigClass\":\"{11}\",\"microCue\":\"{12}\",\"eventBanner\":\"{13}\",\"paradoxes\":{14},\"alleyOops\":{15}}}",
                _isMatchRunning ? "true" : "false",
                _rewindTransitionTimer > 0f ? "true" : "false",
                _isTutorialMode ? "true" : "false",
                _currentLoopIndex + 1,
                Mathf.Max(0f, LOOP_DURATION - _loopTimer),
                _playerScore,
                Mathf.Max(_rivalScore, _rivalTargetScore),
                _playerCarriedCoreId >= 0 ? "true" : "false",
                _dashCooldown <= 0.05f ? "true" : "false",
                _gadgetCooldown <= 0.05f ? "true" : "false",
                camLabel,
                rigClass,
                cue,
                banner,
                _paradoxesTriggered,
                _alleyOopsLanded
            );
            WebGLBridge.SendHudTelemetry(json);
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
