(() => {
  'use strict';

  const { Engine, World, Bodies, Body, Events, Composite } = Matter;

  // Safe localStorage wrappers (prevents SecurityError on strict file:// origins)
  function safeGetItem(key, fallback = null) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  // DOM Elements
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const gameHud = document.getElementById('game-hud');
  const hudStageLabel = document.getElementById('hud-stage-label');
  const hudHint = document.getElementById('hud-hint');
  const inkBarFill = document.getElementById('ink-bar-fill');
  const inkValueText = document.getElementById('ink-value');
  const settingsBtn = document.getElementById('settings-btn');

  // Main Menu Elements
  const mainMenuOverlay = document.getElementById('main-menu-overlay');
  const stageGrid = document.getElementById('stage-grid');
  const stageProgressText = document.getElementById('stage-progress-text');
  const menuSettingsBtn = document.getElementById('menu-settings-btn');

  // Stage Clear / Game Over Modal Elements
  const overlay = document.getElementById('overlay');
  const overlayKicker = document.getElementById('overlay-kicker');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayMessage = document.getElementById('overlay-message');
  const statTime = document.getElementById('stat-time');
  const statInk = document.getElementById('stat-ink');
  const nextStageBtn = document.getElementById('next-stage-btn');
  const retryBtn = document.getElementById('retry-btn');
  const overlayMenuBtn = document.getElementById('overlay-menu-btn');

  // Settings Modal Elements
  const settingsOverlay = document.getElementById('settings-overlay');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const shakeToggleBtn = document.getElementById('shake-toggle-btn');
  const settingsRestartBtn = document.getElementById('settings-restart-btn');
  const settingsMenuBtn = document.getElementById('settings-menu-btn');
  const settingsCloseBtn = document.getElementById('settings-close-btn');

  // Constants & Tuning
  const COLORS = {
    bg: '#1a1c23',
    grid: 'rgba(255, 255, 255, 0.03)',
    platform: '#2a2e3b',
    platformStroke: '#4b5369',
    movingStroke: '#00f0ff',
    ink: '#00f0ff',
    inkCore: '#e0ffff',
    ballFill: '#f3f4f6',
    ballAccent: '#00f0ff',
    spikeFill: '#ff4769',
    goalAccent: '#10b981',
  };

  const INK_CONFIG = {
    maxInk: 900,
    costPerPixel: 1.0,
    regenPerSecond: 220,
    minSegmentDist: 9,
    thickness: 8,
    lifetimeMs: 3500, // 3.5 seconds total lifetime (within 3-4s requirement)
    fadeStartMs: 2300, // Starts fading at 2.3s, fully gone at 3.5s
  };

  const PLAYER_CONFIG = {
    radius: 14,
    dropDelayMs: 550, // Brief hold at top portal so player can see & draw immediately
    maxSpeed: 9.5,
  };

  /**
   * 全5ステージの定義（縦画面・上から下へ落下するボールを誘導する設計）
   */
  const STAGES = [
    {
      id: 1,
      code: 'STAGE 01',
      name: '最初の誘導',
      hint: 'ステージ 01: 斜めの線を描いて、上から落ちるボールを右下のゴールへ誘導してください',
      maxInk: 950,
      startXRatio: 0.26,
      startYRatio: 0.15,
      goalXRatio: 0.74,
      goalWidthRatio: 0.22,
      obstacles: [
        { xRatio: 0.48, yRatio: 0.48, wRatio: 0.34, h: 16 },
      ],
      moving: [],
    },
    {
      id: 2,
      code: 'STAGE 02',
      name: 'ジグザグ降下',
      hint: 'ステージ 02: 互い違いの棚をかわし、左→右へとジグザグに誘導してください',
      maxInk: 950,
      startXRatio: 0.76,
      startYRatio: 0.15,
      goalXRatio: 0.72,
      goalWidthRatio: 0.22,
      obstacles: [
        { xRatio: 0.66, yRatio: 0.37, wRatio: 0.46, h: 16 },
        { xRatio: 0.34, yRatio: 0.62, wRatio: 0.46, h: 16 },
      ],
      moving: [],
    },
    {
      id: 3,
      code: 'STAGE 03',
      name: '中央の要塞',
      hint: 'ステージ 03: 中央のブロックを外側へ迂回させ、下部のゴールへ戻してください',
      maxInk: 920,
      startXRatio: 0.5,
      startYRatio: 0.15,
      goalXRatio: 0.5,
      goalWidthRatio: 0.22,
      obstacles: [
        { xRatio: 0.5, yRatio: 0.38, wRatio: 0.44, h: 18 },
        { xRatio: 0.2, yRatio: 0.64, wRatio: 0.26, h: 16 },
        { xRatio: 0.8, yRatio: 0.64, wRatio: 0.26, h: 16 },
      ],
      moving: [],
    },
    {
      id: 4,
      code: 'STAGE 04',
      name: '動くゲート',
      hint: 'ステージ 04: 左右にスライドする可動ゲートの隙間へボールを誘導してください',
      maxInk: 920,
      startXRatio: 0.28,
      startYRatio: 0.15,
      goalXRatio: 0.72,
      goalWidthRatio: 0.21,
      obstacles: [],
      moving: [
        {
          xRatio: 0.5,
          yRatio: 0.38,
          wRatio: 0.34,
          h: 16,
          ampXRatio: 0.24,
          ampY: 0,
          speed: 0.0024,
          phase: 0,
          isHazard: false,
        },
        {
          xRatio: 0.5,
          yRatio: 0.63,
          wRatio: 0.34,
          h: 16,
          ampXRatio: 0.24,
          ampY: 0,
          speed: 0.0028,
          phase: 2.2,
          isHazard: false,
        },
      ],
    },
    {
      id: 5,
      code: 'STAGE 05',
      name: '深淵の試練',
      hint: 'ステージ 05: 赤いレーザー障壁を避けながら左下のゴールへ導く最終試練',
      maxInk: 860,
      startXRatio: 0.5,
      startYRatio: 0.15,
      goalXRatio: 0.26,
      goalWidthRatio: 0.2,
      obstacles: [
        { xRatio: 0.28, yRatio: 0.35, wRatio: 0.26, h: 16 },
        { xRatio: 0.72, yRatio: 0.66, wRatio: 0.28, h: 16 },
      ],
      moving: [
        {
          xRatio: 0.5,
          yRatio: 0.5,
          wRatio: 0.3,
          h: 16,
          ampXRatio: 0.24,
          ampY: 0,
          speed: 0.0031,
          phase: 0.7,
          isHazard: true,
        },
      ],
    },
  ];

  // User Preferences & Stage Progress (Persisted in localStorage)
  const settings = {
    soundEnabled: safeGetItem('ink_parkour_sound', 'true') !== 'false',
    shakeEnabled: safeGetItem('ink_parkour_shake', 'true') !== 'false',
  };

  let stageProgress = {};
  try {
    const raw = safeGetItem('ink_parkour_progress', '{}');
    stageProgress = JSON.parse(raw) || {};
  } catch (_) {
    stageProgress = {};
  }

  function saveStageProgress(stageId, timeSec, inkPx) {
    const prev = stageProgress[stageId];
    const isNewBest = !prev || timeSec < prev.bestTime;
    stageProgress[stageId] = {
      cleared: true,
      bestTime: prev ? Math.min(prev.bestTime, timeSec) : timeSec,
      bestInk: prev ? Math.min(prev.bestInk, Math.round(inkPx)) : Math.round(inkPx),
    };
    safeSetItem('ink_parkour_progress', JSON.stringify(stageProgress));
    return isNewBest;
  }

  /**
   * Web Audio API Synthesizer for Minimal Vector Sound Effects
   */
  const SoundFX = (() => {
    let audioCtx = null;
    let lastBounceSoundTime = 0;
    let lastDrawSoundTime = 0;

    function ensureContext() {
      if (!settings.soundEnabled) return null;
      try {
        if (!audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
          }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      } catch (_) {
        return null;
      }
      return audioCtx;
    }

    function playUiClick() {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const now = ctxAudio.currentTime;
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(680, now);
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.045);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

        osc.connect(gain);
        gain.connect(ctxAudio.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } catch (_) {}
    }

    function playDrawSegment(inkRatio) {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const perfNow = performance.now();
        if (perfNow - lastDrawSoundTime < 28) return;
        lastDrawSoundTime = perfNow;

        const now = ctxAudio.currentTime;
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();

        const baseFreq = 320 + inkRatio * 360 + (Math.random() - 0.5) * 35;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.18, now + 0.04);

        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

        osc.connect(gain);
        gain.connect(ctxAudio.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } catch (_) {}
    }

    function playBounce(impactSpeed, isInk) {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const perfNow = performance.now();
        if (perfNow - lastBounceSoundTime < 75) return;
        lastBounceSoundTime = perfNow;

        const now = ctxAudio.currentTime;
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();

        const clampedSpeed = Math.min(12, Math.max(1.5, impactSpeed));
        const startFreq = isInk ? 220 + clampedSpeed * 18 : 140 + clampedSpeed * 12;

        osc.type = isInk ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(58, now + 0.09);

        const volume = Math.min(0.16, 0.03 + (clampedSpeed / 12) * 0.12);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

        osc.connect(gain);
        gain.connect(ctxAudio.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      } catch (_) {}
    }

    function playJumpBoost() {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const now = ctxAudio.currentTime;
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);

        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

        osc.connect(gain);
        gain.connect(ctxAudio.destination);
        osc.start(now);
        osc.stop(now + 0.14);
      } catch (_) {}
    }

    function playClear() {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        const now = ctxAudio.currentTime;

        notes.forEach((freq, idx) => {
          const osc = ctxAudio.createOscillator();
          const gain = ctxAudio.createGain();
          const startTime = now + idx * 0.075;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.linearRampToValueAtTime(0.12, startTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.36);

          osc.connect(gain);
          gain.connect(ctxAudio.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.38);
        });
      } catch (_) {}
    }

    function playGameOver() {
      try {
        const ctxAudio = ensureContext();
        if (!ctxAudio) return;

        const now = ctxAudio.currentTime;
        const freqs = [190, 135];

        freqs.forEach((f, idx) => {
          const osc = ctxAudio.createOscillator();
          const gain = ctxAudio.createGain();
          const startTime = now + idx * 0.11;

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f, startTime);
          osc.frequency.exponentialRampToValueAtTime(f * 0.48, startTime + 0.26);

          gain.gain.setValueAtTime(0.09, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

          osc.connect(gain);
          gain.connect(ctxAudio.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.29);
        });
      } catch (_) {}
    }

    return {
      ensureContext,
      playUiClick,
      playDrawSegment,
      playBounce,
      playJumpBoost,
      playClear,
      playGameOver,
    };
  })();

  // State
  let engine = null;
  let world = null;
  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  let currentStageIndex = 0;
  let playerBall = null;
  let isBallReleased = false;
  let spawnPortal = { x: 0, y: 0 };
  let staticPlatforms = [];
  let movingPlatforms = [];
  let goalZone = null;
  let spikeSegments = [];

  // Ink Strokes: array of { points: [{x, y, createdAt}], segments: [{body, p1, p2, createdAt}] }
  let strokes = [];
  let activeStroke = null;
  let isDrawing = false;
  let activePointerId = null;

  let maxStageInk = INK_CONFIG.maxInk;
  let currentInk = INK_CONFIG.maxInk;
  let totalInkUsed = 0;
  let stageStartTime = 0;
  let pausedAccumulatedMs = 0;
  let pauseStartedAt = 0;
  let isSettingsOpen = false;
  let elapsedSeconds = 0;
  let gameState = 'MENU'; // 'MENU' | 'PLAYING' | 'CLEARED' | 'GAMEOVER'

  // Visual Effects (minimal vector trails, ripples, bursts & screen shake)
  let ballTrail = [];
  let particles = [];
  let ripples = [];
  let screenShake = { intensity: 0, durationMs: 0, elapsedMs: 0 };
  let lastBoostEffectTime = 0;

  // Ambient particles for Main Menu background
  let menuBackgroundParticles = [];
  function initMenuBackgroundParticles() {
    menuBackgroundParticles = [];
    const count = 38;
    for (let i = 0; i < count; i++) {
      menuBackgroundParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: 0.25 + Math.random() * 0.65, // Gentle downward drift
        radius: 1.5 + Math.random() * 2.8,
        alpha: 0.15 + Math.random() * 0.35,
        color: Math.random() < 0.6 ? COLORS.ink : (Math.random() < 0.5 ? COLORS.goalAccent : '#ffffff'),
      });
    }
  }

  /**
   * Populate and Refresh Stage Selection Grid on Main Menu
   */
  function renderMainMenu() {
    stageGrid.innerHTML = '';
    let clearedCount = 0;

    STAGES.forEach((stage, index) => {
      const prog = stageProgress[stage.id];
      const isCleared = Boolean(prog && prog.cleared);
      if (isCleared) {
        clearedCount++;
      }

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'stage-card';
      if (index === currentStageIndex) card.classList.add('active-stage');
      if (isCleared) card.classList.add('cleared');

      const bestText = isCleared ? `最高記録 ${prog.bestTime.toFixed(2)}秒` : '未クリア';
      const badgeText = isCleared ? 'クリア済み' : '';

      card.innerHTML = `
        <div class="stage-card-top">
          <span class="stage-card-num">${stage.code}</span>
          <span class="stage-card-badge">${badgeText}</span>
        </div>
        <div class="stage-card-name">${stage.name}</div>
        <div class="stage-card-meta">${bestText}</div>
      `;

      card.addEventListener('click', () => {
        SoundFX.playUiClick();
        startStage(index);
      });

      stageGrid.appendChild(card);
    });

    stageProgressText.textContent = `${clearedCount} / ${STAGES.length} ステージクリア`;
  }

  function showMainMenu() {
    stopDrawing();
    hideOverlay();
    gameState = 'MENU';
    gameHud.classList.add('hud-hidden');
    mainMenuOverlay.classList.remove('hidden');
    renderMainMenu();
    initMenuBackgroundParticles();
    if (engine) {
      World.clear(engine.world, false);
      Engine.clear(engine);
    }
    staticPlatforms = [];
    movingPlatforms = [];
    spikeSegments = [];
    goalZone = null;
    playerBall = null;
  }

  function startStage(stageIndex) {
    currentStageIndex = Math.max(0, Math.min(STAGES.length - 1, stageIndex));
    mainMenuOverlay.classList.add('hidden');
    gameHud.classList.remove('hud-hidden');
    initGame();
  }

  /**
   * Sync Settings Modal Buttons with current state
   */
  function syncSettingsUI() {
    soundToggleBtn.textContent = settings.soundEnabled ? 'ON' : 'OFF';
    soundToggleBtn.classList.toggle('active', settings.soundEnabled);
    soundToggleBtn.setAttribute('aria-pressed', String(settings.soundEnabled));

    shakeToggleBtn.textContent = settings.shakeEnabled ? 'ON' : 'OFF';
    shakeToggleBtn.classList.toggle('active', settings.shakeEnabled);
    shakeToggleBtn.setAttribute('aria-pressed', String(settings.shakeEnabled));
  }

  function openSettings() {
    if (isSettingsOpen) return;
    isSettingsOpen = true;
    stopDrawing();
    pauseStartedAt = performance.now();

    // Toggle restart & menu buttons depending on whether we are in active gameplay
    if (gameState === 'PLAYING') {
      settingsRestartBtn.style.display = 'block';
      settingsMenuBtn.style.display = 'block';
    } else {
      settingsRestartBtn.style.display = 'none';
      settingsMenuBtn.style.display = 'none';
    }

    settingsOverlay.classList.remove('hidden');
    SoundFX.playUiClick();
  }

  function closeSettings() {
    if (!isSettingsOpen) return;
    isSettingsOpen = false;
    if (pauseStartedAt > 0) {
      pausedAccumulatedMs += performance.now() - pauseStartedAt;
      pauseStartedAt = 0;
    }
    settingsOverlay.classList.add('hidden');
    SoundFX.playUiClick();
  }

  /**
   * Trigger Camera Screen Shake
   */
  function triggerScreenShake(intensity, durationMs) {
    if (!settings.shakeEnabled) return;
    screenShake.intensity = Math.max(screenShake.intensity, intensity);
    screenShake.durationMs = Math.max(screenShake.durationMs - screenShake.elapsedMs, durationMs);
    screenShake.elapsedMs = 0;
  }

  /**
   * Spawn Vector Ripple Ring
   */
  function spawnRipple(x, y, maxRadius, color) {
    ripples.push({
      x,
      y,
      radius: 6,
      maxRadius,
      color,
      alpha: 0.85,
    });
  }

  /**
   * Resize Canvas to fit full viewport with crisp HiDPI scaling
   */
  function updateCanvasSize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Build Physics World for Current Stage (playable or background menu preview)
   */
  function buildPreviewOrStage(spawnBall) {
    updateCanvasSize();

    if (engine) {
      World.clear(engine.world, false);
      Engine.clear(engine);
    }

    engine = Engine.create();
    world = engine.world;
    // Gentle vertical gravity suited for top-to-bottom ink guidance
    engine.gravity.y = 0.45;

    strokes = [];
    activeStroke = null;
    isDrawing = false;
    activePointerId = null;
    ballTrail = [];
    particles = [];
    ripples = [];
    screenShake = { intensity: 0, durationMs: 0, elapsedMs: 0 };

    const stage = STAGES[currentStageIndex];
    maxStageInk = stage.maxInk || INK_CONFIG.maxInk;
    currentInk = maxStageInk;
    totalInkUsed = 0;
    stageStartTime = performance.now();
    pausedAccumulatedMs = 0;
    pauseStartedAt = isSettingsOpen ? performance.now() : 0;
    elapsedSeconds = 0;
    isBallReleased = false;

    hudStageLabel.textContent = `${stage.code} — ${stage.name}`;
    hudHint.textContent = stage.hint;
    updateInkUI();

    buildStageGeometry(stage);
    if (spawnBall) {
      spawnPlayer(stage);
      bindCollisionEvents();
    } else {
      playerBall = null;
    }
  }

  /**
   * Start Active Gameplay on Current Stage
   */
  function initGame() {
    hideOverlay();
    gameState = 'PLAYING';
    buildPreviewOrStage(true);
  }

  /**
   * Create Vertical Stage Geometry (Top Spawn Portal, Mid Obstacles, Bottom Goal & Spikes)
   */
  function buildStageGeometry(stage) {
    staticPlatforms = [];
    movingPlatforms = [];
    spikeSegments = [];

    // 1. Top Spawn Portal Coordinates
    const spawnX = Math.max(44, Math.min(width - 44, width * stage.startXRatio));
    const spawnY = Math.max(106, height * stage.startYRatio);
    spawnPortal = { x: spawnX, y: spawnY };

    // 2. Stage Static Obstacles / Deflectors
    for (const obs of stage.obstacles) {
      const obsW = obs.w ? obs.w : Math.max(76, width * obs.wRatio);
      const obsH = obs.h ? obs.h : Math.max(16, height * (obs.hRatio || 0.02));
      const obsX = width * obs.xRatio;
      const obsY = height * obs.yRatio;

      const body = Bodies.rectangle(obsX, obsY, obsW, obsH, {
        isStatic: true,
        angle: obs.angle || 0,
        friction: 0.005,
        restitution: 0.35,
        chamfer: { radius: 4 },
        label: 'stage-platform',
      });
      staticPlatforms.push(body);
    }

    // 3. Stage Moving Platforms / Dynamic Gates
    for (const mov of stage.moving) {
      const movW = mov.w ? mov.w : Math.max(72, width * mov.wRatio);
      const movH = mov.h ? mov.h : Math.max(16, height * (mov.hRatio || 0.02));
      const baseX = width * mov.xRatio;
      const baseY = height * mov.yRatio;
      const ampX = mov.ampXRatio ? width * mov.ampXRatio : mov.ampX || 0;
      const ampY = mov.ampYRatio ? height * mov.ampYRatio : mov.ampY || 0;

      const body = Bodies.rectangle(baseX, baseY, movW, movH, {
        isStatic: true,
        friction: 0.005,
        restitution: 0.35,
        chamfer: { radius: 4 },
        label: mov.isHazard ? 'hazard-block' : 'stage-platform',
      });

      movingPlatforms.push({
        body,
        baseX,
        baseY,
        ampX,
        ampY,
        speed: mov.speed || 0.0025,
        phase: mov.phase || 0,
        isHazard: Boolean(mov.isHazard),
      });
    }

    // 4. Bottom Goal Basket & Sensor
    const goalWidth = Math.max(92, Math.min(180, width * (stage.goalWidthRatio || 0.22)));
    const goalX = Math.max(goalWidth / 2 + 20, Math.min(width - goalWidth / 2 - 20, width * stage.goalXRatio));
    const goalPlatformY = height - 22;
    const goalSensorHeight = 68;
    const goalSensorY = goalPlatformY - goalSensorHeight / 2 - 6;

    // Goal base floor
    const goalFloor = Bodies.rectangle(goalX, goalPlatformY, goalWidth, 16, {
      isStatic: true,
      friction: 0.05,
      restitution: 0.2,
      label: 'stage-platform',
    });
    // Left and right rim walls of the goal basket so the ball is caught cleanly
    const rimHeight = 46;
    const leftRim = Bodies.rectangle(
      goalX - goalWidth / 2 + 5,
      goalPlatformY - rimHeight / 2,
      10,
      rimHeight,
      {
        isStatic: true,
        friction: 0.01,
        restitution: 0.3,
        label: 'stage-platform',
      }
    );
    const rightRim = Bodies.rectangle(
      goalX + goalWidth / 2 - 5,
      goalPlatformY - rimHeight / 2,
      10,
      rimHeight,
      {
        isStatic: true,
        friction: 0.01,
        restitution: 0.3,
        label: 'stage-platform',
      }
    );
    staticPlatforms.push(goalFloor, leftRim, rightRim);

    goalZone = {
      x: goalX,
      y: goalSensorY,
      width: goalWidth - 16,
      height: goalSensorHeight,
      body: Bodies.rectangle(goalX, goalSensorY, goalWidth - 16, goalSensorHeight, {
        isStatic: true,
        isSensor: true,
        label: 'goal-sensor',
      }),
    };

    // 5. Bottom Spike Pit Segments (Left and Right of the Goal Basket)
    const spikeHeight = 24;
    const leftGapWidth = goalX - goalWidth / 2;
    const rightGapStart = goalX + goalWidth / 2;
    const rightGapWidth = width - rightGapStart;

    if (leftGapWidth > 12) {
      const leftSpikeBody = Bodies.rectangle(
        leftGapWidth / 2,
        height - spikeHeight / 2,
        leftGapWidth,
        spikeHeight,
        {
          isStatic: true,
          isSensor: true,
          label: 'spike-sensor',
        }
      );
      spikeSegments.push({
        startX: 0,
        endX: leftGapWidth,
        height: spikeHeight,
        body: leftSpikeBody,
      });
    }

    if (rightGapWidth > 12) {
      const rightSpikeBody = Bodies.rectangle(
        rightGapStart + rightGapWidth / 2,
        height - spikeHeight / 2,
        rightGapWidth,
        spikeHeight,
        {
          isStatic: true,
          isSensor: true,
          label: 'spike-sensor',
        }
      );
      spikeSegments.push({
        startX: rightGapStart,
        endX: width,
        height: spikeHeight,
        body: rightSpikeBody,
      });
    }

    // 6. Left & Right Side Walls (keep ball inside the vertical screen shaft)
    const leftWall = Bodies.rectangle(-10, height / 2, 20, height * 2, {
      isStatic: true,
      restitution: 0.65,
      friction: 0.001,
      label: 'wall',
    });
    const rightWall = Bodies.rectangle(width + 10, height / 2, 20, height * 2, {
      isStatic: true,
      restitution: 0.65,
      friction: 0.001,
      label: 'wall',
    });

    World.add(world, [
      ...staticPlatforms,
      ...movingPlatforms.map((m) => m.body),
      goalZone.body,
      ...spikeSegments.map((s) => s.body),
      leftWall,
      rightWall,
    ]);
  }

  /**
   * Spawn Player Ball at the Top Drop Portal
   */
  function spawnPlayer() {
    playerBall = Bodies.circle(spawnPortal.x, spawnPortal.y, PLAYER_CONFIG.radius, {
      isStatic: true, // Held briefly at top portal for dropDelayMs
      restitution: 0.46,
      friction: 0.001,
      frictionAir: 0.0015,
      density: 0.002,
      label: 'player-ball',
    });

    isBallReleased = false;
    World.add(world, playerBall);
  }

  /**
   * Handle Collisions (Goal, Spikes, Hazard Blocks, Bounce FX, and Slope Guidance)
   */
  function bindCollisionEvents() {
    Events.on(engine, 'collisionStart', (event) => {
      if (gameState !== 'PLAYING') return;

      for (const pair of event.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];

        if (labels.includes('player-ball') && labels.includes('goal-sensor')) {
          triggerStageClear();
          return;
        }

        if (labels.includes('player-ball') && labels.includes('spike-sensor')) {
          triggerGameOver('下部のトゲに落下しました。インクの線でゴール枠へ誘導してください。');
          return;
        }

        if (labels.includes('player-ball') && labels.includes('hazard-block')) {
          triggerGameOver('赤いレーザー障壁に接触しました。線を描いて軌道をそらしてください。');
          return;
        }

        // Bounce on stage platform or wall
        if (
          labels.includes('player-ball') &&
          (labels.includes('stage-platform') || labels.includes('wall'))
        ) {
          const speed = Math.hypot(playerBall.velocity.x, playerBall.velocity.y);
          if (speed > 1.8) {
            SoundFX.playBounce(speed, false);
            if (speed > 4.5) {
              triggerScreenShake(Math.min(4.5, speed * 0.4), 100);
              spawnRipple(playerBall.position.x, playerBall.position.y, 24, '#8b92a5');
            }
          }
        }

        // Ink segment contact: smooth slope deflection & bounce feedback
        if (labels.includes('player-ball') && labels.includes('ink-segment')) {
          const inkBody = pair.bodyA.label === 'ink-segment' ? pair.bodyA : pair.bodyB;
          const vel = playerBall.velocity;
          const speed = Math.hypot(vel.x, vel.y);

          // Normalize ink segment angle to [-PI/2, PI/2] to determine downward slope direction
          let a = inkBody.angle;
          while (a > Math.PI / 2) a -= Math.PI;
          while (a < -Math.PI / 2) a += Math.PI;

          // Downward tangent vector along the sloped ink segment
          if (Math.abs(a) > 0.06) {
            const dir = a > 0 ? 1 : -1;
            const tx = Math.cos(Math.abs(a)) * dir;
            const ty = Math.sin(Math.abs(a));
            const slideBoost = 1.35;

            Body.setVelocity(playerBall, {
              x: vel.x * 0.82 + tx * slideBoost,
              y: vel.y * 0.85 + ty * 0.6,
            });

            const now = performance.now();
            if (now - lastBoostEffectTime > 150) {
              lastBoostEffectTime = now;
              SoundFX.playJumpBoost();
              spawnRipple(playerBall.position.x, playerBall.position.y, 30, COLORS.ink);
              spawnBurstParticles(playerBall.position.x, playerBall.position.y, COLORS.ink, 5, 0.7);
            }
          } else if (speed > 1.6) {
            SoundFX.playBounce(speed, true);
            spawnRipple(playerBall.position.x, playerBall.position.y, 24, COLORS.ink);
          }
        }
      }
    });
  }

  /**
   * Trigger Stage Clear
   */
  function triggerStageClear() {
    if (gameState !== 'PLAYING') return;
    gameState = 'CLEARED';
    if (activePointerId !== null && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch (_) {}
    }
    isDrawing = false;
    activeStroke = null;
    activePointerId = null;

    const stage = STAGES[currentStageIndex];
    const isNewBest = saveStageProgress(stage.id, elapsedSeconds, totalInkUsed);

    SoundFX.playClear();
    triggerScreenShake(6, 220);
    spawnBurstParticles(goalZone.x, goalZone.y, COLORS.goalAccent, 32);
    spawnRipple(goalZone.x, goalZone.y, 85, COLORS.goalAccent);
    if (playerBall) {
      spawnRipple(playerBall.position.x, playerBall.position.y, 50, COLORS.ink);
      Body.setStatic(playerBall, true);
    }

    const hasNextStage = currentStageIndex < STAGES.length - 1;
    overlayKicker.textContent = isNewBest ? `${stage.code} — 新記録達成！` : `${stage.code} クリア`;
    overlayKicker.classList.remove('danger');
    overlayTitle.textContent = hasNextStage ? 'ステージクリア' : '全ステージ完全制覇！';
    overlayMessage.textContent = hasNextStage
      ? `「${stage.name}」を突破しました！次のステージへ進めます。`
      : 'おめでとうございます！全5ステージをすべて制覇しました！';

    statTime.textContent = `${elapsedSeconds.toFixed(2)}秒`;
    statInk.textContent = `${Math.round(totalInkUsed)}px`;

    if (hasNextStage) {
      nextStageBtn.textContent = `次へ: ${STAGES[currentStageIndex + 1].code}`;
      nextStageBtn.classList.remove('btn-hidden');
    } else {
      nextStageBtn.classList.add('btn-hidden');
    }

    showOverlay();
  }

  /**
   * Trigger Game Over
   */
  function triggerGameOver(reasonMessage) {
    if (gameState !== 'PLAYING') return;
    gameState = 'GAMEOVER';
    if (activePointerId !== null && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch (_) {}
    }
    isDrawing = false;
    activeStroke = null;
    activePointerId = null;

    SoundFX.playGameOver();
    triggerScreenShake(9, 280);
    const impactX = playerBall ? Math.min(width - 16, Math.max(16, playerBall.position.x)) : width / 2;
    const impactY = playerBall ? Math.min(height - 16, Math.max(16, playerBall.position.y)) : height / 2;
    spawnBurstParticles(impactX, impactY, COLORS.spikeFill, 28);
    spawnRipple(impactX, impactY, 64, COLORS.spikeFill);

    const stage = STAGES[currentStageIndex];
    overlayKicker.textContent = `${stage.code} — 失敗`;
    overlayKicker.classList.add('danger');
    overlayTitle.textContent = 'ゲームオーバー';
    overlayMessage.textContent = reasonMessage || '下部のトゲに落下しました。インクの線でゴール枠へ誘導してください。';
    statTime.textContent = `${elapsedSeconds.toFixed(2)}秒`;
    statInk.textContent = `${Math.round(totalInkUsed)}px`;
    nextStageBtn.classList.add('btn-hidden');
    showOverlay();
  }

  function showOverlay() {
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  /**
   * Vector Burst Particles for Clear / Game Over / Ink Sparks
   */
  function spawnBurstParticles(x, y, color, count, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = (1.8 + Math.random() * 5.2) * speedScale;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.0 * speedScale,
        size: (2.5 + Math.random() * 3.5) * Math.min(1.2, speedScale + 0.3),
        color,
        alpha: 1,
      });
    }
  }

  /**
   * Ink Drawing Logic: Record pointer trajectory and spawn static Matter.js segments
   */
  function getCanvasCoords(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDrawing(event) {
    if (gameState !== 'PLAYING' || isSettingsOpen) return;
    SoundFX.ensureContext();
    if (currentInk <= 5) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {}
    }

    const pt = getCanvasCoords(event);
    isDrawing = true;
    activeStroke = {
      points: [{ x: pt.x, y: pt.y, createdAt: performance.now() }],
      segments: [],
    };
    strokes.push(activeStroke);
    spawnRipple(pt.x, pt.y, 18, COLORS.ink);
  }

  function moveDrawing(event) {
    if (!isDrawing || !activeStroke || gameState !== 'PLAYING' || isSettingsOpen) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    event.preventDefault();
    const pt = getCanvasCoords(event);
    const pts = activeStroke.points;
    const prev = pts[pts.length - 1];

    const dx = pt.x - prev.x;
    const dy = pt.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist < INK_CONFIG.minSegmentDist) return;

    const inkNeeded = dist * INK_CONFIG.costPerPixel;
    if (currentInk < inkNeeded) {
      stopDrawing();
      return;
    }

    // Consume ink
    currentInk = Math.max(0, currentInk - inkNeeded);
    totalInkUsed += dist;
    updateInkUI();

    const inkRatio = currentInk / maxStageInk;
    SoundFX.playDrawSegment(inkRatio);

    if (Math.random() < 0.45) {
      spawnBurstParticles(pt.x, pt.y, COLORS.ink, 2, 0.45);
    }

    const now = performance.now();
    const newPoint = { x: pt.x, y: pt.y, createdAt: now };
    pts.push(newPoint);

    const midX = (prev.x + newPoint.x) / 2;
    const midY = (prev.y + newPoint.y) / 2;
    const angle = Math.atan2(dy, dx);

    const segmentBody = Bodies.rectangle(
      midX,
      midY,
      dist + 2,
      INK_CONFIG.thickness,
      {
        isStatic: true,
        angle,
        friction: 0.001,
        restitution: 0.42,
        chamfer: { radius: INK_CONFIG.thickness / 2 },
        label: 'ink-segment',
      }
    );

    World.add(world, segmentBody);
    activeStroke.segments.push({
      body: segmentBody,
      p1: prev,
      p2: newPoint,
      createdAt: now,
    });
  }

  function stopDrawing(event) {
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    if (activePointerId !== null && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch (_) {}
    }
    isDrawing = false;
    activeStroke = null;
    activePointerId = null;
  }

  /**
   * Update Ink Gauge DOM
   */
  function updateInkUI() {
    const ratio = Math.max(0, Math.min(1, currentInk / maxStageInk));
    const percent = Math.round(ratio * 100);
    inkBarFill.style.width = `${percent}%`;
    inkValueText.textContent = `${percent}%`;

    if (percent <= 20) {
      inkBarFill.classList.add('low');
    } else {
      inkBarFill.classList.remove('low');
    }
  }

  /**
   * Update Physics, Moving Platforms, Ball Drop & Guidance, Ink Regeneration, and Stroke Expiration
   */
  function update(dtMs, now) {
    if (isSettingsOpen) return;

    const dtSec = dtMs / 1000;
    const simTime = now - pausedAccumulatedMs;

    // Update Moving Platforms / Obstacles
    for (const m of movingPlatforms) {
      const prevX = m.body.position.x;
      const prevY = m.body.position.y;
      const nextX = m.baseX + Math.sin(simTime * m.speed + m.phase) * m.ampX;
      const nextY = m.baseY + Math.sin(simTime * m.speed + m.phase) * m.ampY;

      Body.setVelocity(m.body, {
        x: nextX - prevX,
        y: nextY - prevY,
      });
      Body.setPosition(m.body, { x: nextX, y: nextY });
    }

    if (gameState === 'PLAYING') {
      const activeMs = Math.max(0, now - stageStartTime - pausedAccumulatedMs);
      elapsedSeconds = activeMs / 1000;

      // Release ball from top spawn portal after brief countdown
      if (playerBall && !isBallReleased && activeMs >= PLAYER_CONFIG.dropDelayMs) {
        isBallReleased = true;
        Body.setStatic(playerBall, false);
        Body.setVelocity(playerBall, { x: 0, y: 1.0 });
        spawnRipple(spawnPortal.x, spawnPortal.y, 32, COLORS.ink);
      }

      if (playerBall && isBallReleased) {
        // Clamp maximum velocity so ball never tunnels through thin ink lines
        const vx = playerBall.velocity.x;
        const vy = playerBall.velocity.y;
        const speed = Math.hypot(vx, vy);
        if (speed > PLAYER_CONFIG.maxSpeed) {
          const scale = PLAYER_CONFIG.maxSpeed / speed;
          Body.setVelocity(playerBall, { x: vx * scale, y: vy * scale });
        }

        // Prevent getting completely stuck on a flat surface
        if (Math.abs(vx) < 0.25 && Math.abs(vy) < 0.2) {
          const dirToGoal = goalZone && goalZone.x >= playerBall.position.x ? 1 : -1;
          Body.setVelocity(playerBall, {
            x: dirToGoal * 1.9,
            y: -0.6,
          });
        }

        // Out-of-bounds bottom check
        if (playerBall.position.y > height + 36) {
          triggerGameOver('コース外へ落下しました。インクの線でゴール枠へ誘導してください。');
        }

        // Record ball trail
        ballTrail.push({
          x: playerBall.position.x,
          y: playerBall.position.y,
        });
        if (ballTrail.length > 16) {
          ballTrail.shift();
        }
      }

      // Regenerate ink when not drawing
      if (!isDrawing && currentInk < maxStageInk) {
        currentInk = Math.min(
          maxStageInk,
          currentInk + INK_CONFIG.regenPerSecond * dtSec
        );
        updateInkUI();
      }
    } else if (gameState === 'CLEARED' && playerBall && goalZone) {
      // Smoothly pull the ball toward the center of the Goal Portal on Stage Clear
      const nextX = playerBall.position.x + (goalZone.x - playerBall.position.x) * 0.14;
      const nextY = playerBall.position.y + (goalZone.y - playerBall.position.y) * 0.14;
      Body.setPosition(playerBall, { x: nextX, y: nextY });
      Body.setAngle(playerBall, playerBall.angle + 0.12);
    }

    // Fade out and remove ink segments after 3.5 seconds
    for (let sIdx = strokes.length - 1; sIdx >= 0; sIdx--) {
      const stroke = strokes[sIdx];

      for (let i = stroke.segments.length - 1; i >= 0; i--) {
        const seg = stroke.segments[i];
        const age = now - seg.createdAt;
        if (age >= INK_CONFIG.lifetimeMs) {
          Composite.remove(world, seg.body);
          stroke.segments.splice(i, 1);
        }
      }

      stroke.points = stroke.points.filter((pt) => now - pt.createdAt < INK_CONFIG.lifetimeMs);

      if (stroke !== activeStroke && stroke.segments.length === 0 && stroke.points.length <= 1) {
        strokes.splice(sIdx, 1);
      }
    }

    // Update burst particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.14;
      p.alpha -= 0.024;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      }
    }

    // Update expanding vector ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += (r.maxRadius - r.radius) * 0.18 + 0.9;
      r.alpha -= 0.038;
      if (r.alpha <= 0 || r.radius >= r.maxRadius) {
        ripples.splice(i, 1);
      }
    }

    // Update screen shake decay
    if (screenShake.durationMs > 0) {
      screenShake.elapsedMs += dtMs;
      if (screenShake.elapsedMs >= screenShake.durationMs) {
        screenShake.intensity = 0;
        screenShake.durationMs = 0;
        screenShake.elapsedMs = 0;
      }
    }

    if (engine) {
      Engine.update(engine, Math.min(dtMs, 20));
    }
  }

  /**
   * Compute Alpha for an ink element based on its age (fades out between 2.3s and 3.5s)
   */
  function getInkAlpha(createdAt, now) {
    const age = now - createdAt;
    if (age <= INK_CONFIG.fadeStartMs) return 1;
    if (age >= INK_CONFIG.lifetimeMs) return 0;
    return 1 - (age - INK_CONFIG.fadeStartMs) / (INK_CONFIG.lifetimeMs - INK_CONFIG.fadeStartMs);
  }

  /**
   * Render Everything onto Canvas
   */
  function render(now) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();

    if (screenShake.durationMs > 0 && settings.shakeEnabled) {
      const decay = 1 - screenShake.elapsedMs / screenShake.durationMs;
      const mag = screenShake.intensity * decay;
      const offsetX = (Math.random() - 0.5) * 2 * mag;
      const offsetY = (Math.random() - 0.5) * 2 * mag;
      ctx.translate(offsetX, offsetY);
    }

    drawGrid();

    // In Main Menu: show ambient floating particles instead of game stage elements
    if (gameState === 'MENU') {
      drawMenuBackground(now);
      ctx.restore();
      return;
    }

    drawSpawnPortal(now);
    drawStagePlatforms();
    drawMovingPlatforms(now);
    drawGoalZone(now);
    drawSpikePit();
    drawInkStrokes(now);
    drawRipples();
    drawPlayerBall();
    drawParticles();

    ctx.restore();
  }

  function drawMenuBackground(now) {
    ctx.save();
    for (const p of menuBackgroundParticles) {
      p.y += p.vy;
      p.x += p.vx;
      if (p.y > height + 10) {
        p.y = -10;
        p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGrid() {
    const step = 48;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  function drawSpawnPortal(now) {
    const { x, y } = spawnPortal;
    const pulse = (Math.sin(now * 0.006) + 1) * 0.5;

    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.45 + pulse * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_CONFIG.radius + 7 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

    // Downward indicator chevron below spawn portal
    ctx.beginPath();
    ctx.moveTo(x - 6, y + PLAYER_CONFIG.radius + 14);
    ctx.lineTo(x, y + PLAYER_CONFIG.radius + 20);
    ctx.lineTo(x + 6, y + PLAYER_CONFIG.radius + 14);
    ctx.stroke();

    ctx.fillStyle = COLORS.ink;
    ctx.globalAlpha = 0.8;
    ctx.font = '700 10px "Space Grotesk", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DROP', x, y - PLAYER_CONFIG.radius - 12);
    ctx.restore();
  }

  function drawStagePlatforms() {
    ctx.fillStyle = COLORS.platform;
    ctx.strokeStyle = COLORS.platformStroke;
    ctx.lineWidth = 1.5;

    for (const body of staticPlatforms) {
      const verts = body.vertices;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawMovingPlatforms(now) {
    if (movingPlatforms.length === 0) return;

    ctx.save();
    for (const m of movingPlatforms) {
      // Draw subtle guide track line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(m.baseX - m.ampX, m.baseY - m.ampY);
      ctx.lineTo(m.baseX + m.ampX, m.baseY + m.ampY);
      ctx.stroke();
      ctx.setLineDash([]);

      const verts = m.body.vertices;
      ctx.fillStyle = m.isHazard ? 'rgba(255, 71, 105, 0.22)' : COLORS.platform;
      ctx.strokeStyle = m.isHazard ? COLORS.spikeFill : COLORS.movingStroke;
      ctx.lineWidth = 1.8;

      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const pulse = (Math.sin(now * 0.008) + 1) * 0.5;
      ctx.fillStyle = m.isHazard ? COLORS.spikeFill : COLORS.movingStroke;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.beginPath();
      ctx.arc(m.body.position.x, m.body.position.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawGoalZone(now) {
    if (!goalZone) return;
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    const { x, y, width: gw, height: gh } = goalZone;
    const left = x - gw / 2;
    const top = y - gh / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.fillRect(left, top, gw, gh);

    ctx.strokeStyle = COLORS.goalAccent;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, gw, gh);

    const inset = 5 + pulse * 3;
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    ctx.strokeRect(left + inset, top + inset, gw - inset * 2, gh - inset * 2);

    ctx.globalAlpha = 0.3 + pulse * 0.25;
    ctx.beginPath();
    ctx.arc(x, y, 7 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = COLORS.goalAccent;
    ctx.font = '700 11px "Space Grotesk", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL (ゴール)', x, top - 8);
    ctx.restore();
  }

  function drawSpikePit() {
    if (spikeSegments.length === 0) return;
    const spikeWidth = 20;
    const baseY = height;

    ctx.save();
    ctx.fillStyle = COLORS.spikeFill;
    ctx.beginPath();
    for (const seg of spikeSegments) {
      const tipY = height - seg.height;
      for (let x = seg.startX; x < seg.endX - 4; x += spikeWidth) {
        const w = Math.min(spikeWidth, seg.endX - x);
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + w / 2, tipY);
        ctx.lineTo(x + w, baseY);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawInkStrokes(now) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      const pts = stroke.points;
      if (pts.length < 2) continue;

      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i === 0 ? 0 : i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];

        const alpha = getInkAlpha(p2.createdAt, now);
        if (alpha <= 0.01) continue;

        const startX = i === 0 ? p1.x : (p0.x + p1.x) / 2;
        const startY = i === 0 ? p1.y : (p0.y + p1.y) / 2;
        const endX = i === pts.length - 2 ? p2.x : (p1.x + p2.x) / 2;
        const endY = i === pts.length - 2 ? p2.y : (p1.y + p2.y) / 2;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = INK_CONFIG.thickness;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
        ctx.stroke();

        ctx.strokeStyle = COLORS.inkCore;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawRipples() {
    if (ripples.length === 0) return;
    ctx.save();
    ctx.lineWidth = 1.8;
    for (const r of ripples) {
      ctx.globalAlpha = Math.max(0, r.alpha);
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayerBall() {
    if (!playerBall) return;

    ctx.save();
    for (let i = 0; i < ballTrail.length; i++) {
      const t = ballTrail[i];
      const ratio = (i + 1) / ballTrail.length;
      ctx.globalAlpha = ratio * 0.22;
      ctx.fillStyle = COLORS.ballAccent;
      ctx.beginPath();
      ctx.arc(t.x, t.y, PLAYER_CONFIG.radius * ratio * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const { x, y } = playerBall.position;
    const r = PLAYER_CONFIG.radius;
    const angle = playerBall.angle;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = COLORS.ballFill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1a1c23';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r + 3, 0);
    ctx.lineTo(r - 3, 0);
    ctx.stroke();

    ctx.fillStyle = COLORS.ballAccent;
    ctx.beginPath();
    ctx.arc(r * 0.42, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    if (particles.length === 0) return;
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  /**
   * Main Animation Loop
   */
  let lastFrameTime = performance.now();
  function loop(now) {
    const dtMs = Math.min(32, Math.max(1, now - lastFrameTime));
    lastFrameTime = now;

    update(dtMs, now);
    render(now);

    requestAnimationFrame(loop);
  }

  // Event Listeners (Pointer Events unify Mouse and Touch cleanly)
  canvas.addEventListener('pointerdown', startDrawing, { passive: false });
  canvas.addEventListener('pointermove', moveDrawing, { passive: false });
  window.addEventListener('pointerup', stopDrawing);
  window.addEventListener('pointercancel', stopDrawing);

  // Prevent any residual touch scrolling on mobile browsers
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // HUD & Result Action Buttons
  retryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    initGame();
    SoundFX.playUiClick();
  });

  nextStageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentStageIndex < STAGES.length - 1) {
      startStage(currentStageIndex + 1);
      SoundFX.playUiClick();
    }
  });

  overlayMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    SoundFX.playUiClick();
    showMainMenu();
  });

  // Settings Modal Controls (Accessible from both Main Menu and In-Game HUD)
  settingsBtn.addEventListener('click', () => {
    if (isSettingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  menuSettingsBtn.addEventListener('click', () => {
    openSettings();
  });

  settingsRestartBtn.addEventListener('click', () => {
    closeSettings();
    SoundFX.playUiClick();
    initGame();
  });

  settingsMenuBtn.addEventListener('click', () => {
    closeSettings();
    SoundFX.playUiClick();
    showMainMenu();
  });

  settingsCloseBtn.addEventListener('click', () => {
    closeSettings();
  });

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      closeSettings();
    }
  });

  soundToggleBtn.addEventListener('click', () => {
    settings.soundEnabled = !settings.soundEnabled;
    safeSetItem('ink_parkour_sound', String(settings.soundEnabled));
    syncSettingsUI();
    if (settings.soundEnabled) {
      SoundFX.playUiClick();
    }
  });

  shakeToggleBtn.addEventListener('click', () => {
    settings.shakeEnabled = !settings.shakeEnabled;
    safeSetItem('ink_parkour_shake', String(settings.shakeEnabled));
    syncSettingsUI();
    SoundFX.playUiClick();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isSettingsOpen) {
        closeSettings();
      } else if (gameState === 'PLAYING') {
        showMainMenu();
      }
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && !isSettingsOpen && gameState !== 'MENU') {
      initGame();
      SoundFX.playUiClick();
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (gameState === 'MENU') {
        buildPreviewOrStage(false);
      } else {
        initGame();
      }
    }, 150);
  });

  // Boot Game into Main Menu
  syncSettingsUI();
  showMainMenu();
  requestAnimationFrame(loop);
})();
