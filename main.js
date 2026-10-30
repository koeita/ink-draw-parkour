(() => {
  'use strict';

  const { Engine, World, Bodies, Body, Events, Composite } = Matter;

  // DOM Elements
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const inkBarFill = document.getElementById('ink-bar-fill');
  const inkValueText = document.getElementById('ink-value');
  const quickResetBtn = document.getElementById('quick-reset-btn');
  const overlay = document.getElementById('overlay');
  const overlayKicker = document.getElementById('overlay-kicker');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayMessage = document.getElementById('overlay-message');
  const statTime = document.getElementById('stat-time');
  const statInk = document.getElementById('stat-ink');
  const retryBtn = document.getElementById('retry-btn');

  // Constants & Tuning
  const COLORS = {
    bg: '#1a1c23',
    grid: 'rgba(255, 255, 255, 0.03)',
    platform: '#2a2e3b',
    platformStroke: '#4b5369',
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
    regenPerSecond: 210,
    minSegmentDist: 10,
    thickness: 8,
    lifetimeMs: 3500, // 3.5 seconds total lifetime (within 3-4s requirement)
    fadeStartMs: 2300, // Starts fading at 2.3s, fully gone at 3.5s
  };

  const PLAYER_CONFIG = {
    radius: 16,
    propulsionForce: 0.00052,
    maxHorizontalSpeed: 7.2,
    minRollAssistSpeed: 2.6,
  };

  // State
  let engine = null;
  let world = null;
  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  let playerBall = null;
  let staticPlatforms = [];
  let goalZone = null;
  let spikeZone = null;

  // Ink Strokes: array of { points: [{x, y, createdAt}], segments: [{body, p1, p2, createdAt}] }
  let strokes = [];
  let activeStroke = null;
  let isDrawing = false;
  let activePointerId = null;

  let currentInk = INK_CONFIG.maxInk;
  let totalInkUsed = 0;
  let stageStartTime = 0;
  let elapsedSeconds = 0;
  let gameState = 'PLAYING'; // 'PLAYING' | 'CLEARED' | 'GAMEOVER'

  // Visual Effects (minimal vector trails & bursts)
  let ballTrail = [];
  let particles = [];

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
   * Build or Rebuild Stage Geometry & Physics World
   */
  function initGame() {
    updateCanvasSize();

    if (engine) {
      World.clear(engine.world, false);
      Engine.clear(engine);
    }

    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 0.82;

    strokes = [];
    activeStroke = null;
    isDrawing = false;
    activePointerId = null;
    ballTrail = [];
    particles = [];

    currentInk = INK_CONFIG.maxInk;
    totalInkUsed = 0;
    stageStartTime = performance.now();
    elapsedSeconds = 0;
    gameState = 'PLAYING';
    hideOverlay();
    updateInkUI();

    buildStageGeometry();
    spawnPlayer();
    bindCollisionEvents();
  }

  /**
   * Create Minimal Parkour Stage (Start Ledge, Mid Obstacles, Goal Portal, Bottom Spikes)
   */
  function buildStageGeometry() {
    staticPlatforms = [];

    const startPlatformWidth = Math.max(140, width * 0.16);
    const startPlatformY = height * 0.52;

    // 1. Left Starting Platform
    const startPlatform = Bodies.rectangle(
      startPlatformWidth / 2,
      startPlatformY,
      startPlatformWidth,
      16,
      {
        isStatic: true,
        friction: 0.01,
        restitution: 0.2,
        label: 'stage-platform',
      }
    );
    staticPlatforms.push(startPlatform);

    // 2. Mid-stage Floating Obstacle / Pillar to encourage parkour arcs
    const midPillarX = width * 0.52;
    const midPillarY = height * 0.56;
    const midPlatform = Bodies.rectangle(midPillarX, midPillarY, Math.max(80, width * 0.08), 16, {
      isStatic: true,
      friction: 0.01,
      restitution: 0.2,
      label: 'stage-platform',
    });
    staticPlatforms.push(midPlatform);

    // 3. Right Goal Platform & Sensor at Right Edge
    const goalPlatformWidth = Math.max(110, width * 0.12);
    const goalPlatformX = width - goalPlatformWidth / 2;
    const goalPlatformY = height * 0.46;

    const goalPlatform = Bodies.rectangle(
      goalPlatformX,
      goalPlatformY,
      goalPlatformWidth,
      16,
      {
        isStatic: true,
        friction: 0.02,
        restitution: 0.2,
        label: 'stage-platform',
      }
    );
    staticPlatforms.push(goalPlatform);

    const goalSensorWidth = Math.max(72, goalPlatformWidth * 0.7);
    const goalSensorHeight = 110;
    goalZone = {
      x: width - goalSensorWidth / 2 - 12,
      y: goalPlatformY - goalSensorHeight / 2 - 8,
      width: goalSensorWidth,
      height: goalSensorHeight,
      body: Bodies.rectangle(
        width - goalSensorWidth / 2 - 12,
        goalPlatformY - goalSensorHeight / 2 - 8,
        goalSensorWidth,
        goalSensorHeight,
        {
          isStatic: true,
          isSensor: true,
          label: 'goal-sensor',
        }
      ),
    };

    // 4. Bottom Spike Pit Sensor
    const spikeHeight = 28;
    spikeZone = {
      y: height - spikeHeight,
      height: spikeHeight,
      body: Bodies.rectangle(width / 2, height - spikeHeight / 2, width * 2, spikeHeight, {
        isStatic: true,
        isSensor: true,
        label: 'spike-sensor',
      }),
    };

    // Left wall so the ball never falls off the left side
    const leftWall = Bodies.rectangle(-10, height / 2, 20, height * 2, {
      isStatic: true,
      restitution: 0.6,
      label: 'wall',
    });

    World.add(world, [
      ...staticPlatforms,
      goalZone.body,
      spikeZone.body,
      leftWall,
    ]);
  }

  /**
   * Spawn Player Ball on the left side
   */
  function spawnPlayer() {
    const startX = Math.max(54, width * 0.05);
    const startY = height * 0.52 - 48;

    playerBall = Bodies.circle(startX, startY, PLAYER_CONFIG.radius, {
      restitution: 0.42,
      friction: 0.004,
      frictionAir: 0.002,
      density: 0.002,
      label: 'player-ball',
    });

    // Initial gentle rightward velocity
    Body.setVelocity(playerBall, { x: 2.8, y: 0 });
    World.add(world, playerBall);
  }

  /**
   * Handle Collisions (Goal, Spikes, and Jump-Ramp Boost on Ink Lines)
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
          triggerGameOver();
          return;
        }

        // Ink segment contact: give smooth bounce / ramp launch feel
        if (labels.includes('player-ball') && labels.includes('ink-segment')) {
          const inkBody = pair.bodyA.label === 'ink-segment' ? pair.bodyA : pair.bodyB;
          const vel = playerBall.velocity;

          // If the ink segment is angled upward in the direction of movement, give a slight parkour launch boost
          const angle = inkBody.angle;
          if (vel.x > 1.2 && angle < -0.12 && angle > -1.3) {
            const boostX = Math.min(vel.x * 1.06 + 0.35, PLAYER_CONFIG.maxHorizontalSpeed);
            const boostY = Math.min(vel.y, -Math.abs(Math.sin(angle)) * 4.2);
            Body.setVelocity(playerBall, { x: boostX, y: boostY });
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
    isDrawing = false;
    activeStroke = null;

    spawnBurstParticles(playerBall.position.x, playerBall.position.y, COLORS.goalAccent, 28);

    overlayKicker.textContent = 'MISSION ACCOMPLISHED';
    overlayKicker.classList.remove('danger');
    overlayTitle.textContent = 'STAGE CLEAR';
    overlayMessage.textContent = '描いたインクの軌跡でゴールへ到達しました。';
    statTime.textContent = `${elapsedSeconds.toFixed(2)}s`;
    statInk.textContent = `${Math.round(totalInkUsed)}px`;
    showOverlay();
  }

  /**
   * Trigger Game Over
   */
  function triggerGameOver() {
    if (gameState !== 'PLAYING') return;
    gameState = 'GAMEOVER';
    isDrawing = false;
    activeStroke = null;

    spawnBurstParticles(playerBall.position.x, playerBall.position.y, COLORS.spikeFill, 26);

    overlayKicker.textContent = 'SYSTEM FAILURE';
    overlayKicker.classList.add('danger');
    overlayTitle.textContent = 'GAME OVER';
    overlayMessage.textContent = '谷底のトゲに落下しました。足場を描いて再挑戦してください。';
    statTime.textContent = `${elapsedSeconds.toFixed(2)}s`;
    statInk.textContent = `${Math.round(totalInkUsed)}px`;
    showOverlay();
  }

  function showOverlay() {
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  /**
   * Vector Burst Particles for Clear / Game Over Feedback
   */
  function spawnBurstParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
      const speed = 2 + Math.random() * 6;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        size: 3 + Math.random() * 4,
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
    if (gameState !== 'PLAYING') return;
    if (currentInk <= 5) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture errors on synthetic events
      }
    }

    const pt = getCanvasCoords(event);
    isDrawing = true;
    activeStroke = {
      points: [{ x: pt.x, y: pt.y, createdAt: performance.now() }],
      segments: [],
    };
    strokes.push(activeStroke);
  }

  function moveDrawing(event) {
    if (!isDrawing || !activeStroke || gameState !== 'PLAYING') return;
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
      // Out of ink: stop current stroke cleanly
      stopDrawing();
      return;
    }

    // Consume ink
    currentInk = Math.max(0, currentInk - inkNeeded);
    totalInkUsed += dist;
    updateInkUI();

    const now = performance.now();
    const newPoint = { x: pt.x, y: pt.y, createdAt: now };
    pts.push(newPoint);

    // Create static Matter.js segment along (prev -> newPoint)
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
        friction: 0.002,
        restitution: 0.45,
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
    isDrawing = false;
    activeStroke = null;
    activePointerId = null;
  }

  /**
   * Update Ink Gauge DOM
   */
  function updateInkUI() {
    const ratio = Math.max(0, Math.min(1, currentInk / INK_CONFIG.maxInk));
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
   * Update Physics, Player Propulsion, Ink Regeneration, and Stroke Expiration
   */
  function update(dtMs, now) {
    const dtSec = dtMs / 1000;

    if (gameState === 'PLAYING') {
      elapsedSeconds = (now - stageStartTime) / 1000;

      // 1. Constant slight rightward propulsion force on the player ball
      if (playerBall) {
        if (playerBall.velocity.x < PLAYER_CONFIG.maxHorizontalSpeed) {
          Body.applyForce(playerBall, playerBall.position, {
            x: PLAYER_CONFIG.propulsionForce,
            y: 0,
          });
        }

        // Prevent getting completely stuck horizontally on flat surfaces
        if (Math.abs(playerBall.velocity.x) < 0.4 && Math.abs(playerBall.velocity.y) < 0.25) {
          Body.setVelocity(playerBall, {
            x: PLAYER_CONFIG.minRollAssistSpeed,
            y: playerBall.velocity.y,
          });
        }

        // Out-of-bounds right check (if jumping over the goal sensor at high altitude)
        if (
          playerBall.position.x >= width - 24 &&
          playerBall.position.y < spikeZone.y - 20
        ) {
          triggerStageClear();
        }

        // Out-of-bounds bottom check
        if (playerBall.position.y > height + 40) {
          triggerGameOver();
        }

        // Record ball trail
        ballTrail.push({
          x: playerBall.position.x,
          y: playerBall.position.y,
          alpha: 0.45,
        });
        if (ballTrail.length > 16) {
          ballTrail.shift();
        }
      }

      // 2. Regenerate ink when not drawing
      if (!isDrawing && currentInk < INK_CONFIG.maxInk) {
        currentInk = Math.min(
          INK_CONFIG.maxInk,
          currentInk + INK_CONFIG.regenPerSecond * dtSec
        );
        updateInkUI();
      }
    }

    // 3. Fade out and remove ink segments after 3.5 seconds
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

      // Filter points older than lifetime
      stroke.points = stroke.points.filter((pt) => now - pt.createdAt < INK_CONFIG.lifetimeMs);

      if (stroke !== activeStroke && stroke.segments.length === 0 && stroke.points.length <= 1) {
        strokes.splice(sIdx, 1);
      }
    }

    // 4. Update burst particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.alpha -= 0.024;
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      }
    }

    // Step Matter.js physics engine
    Engine.update(engine, Math.min(dtMs, 20));
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
    // 1. Dark Minimal Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle geometric grid
    drawGrid();

    // 2. Stage Platforms
    drawStagePlatforms();

    // 3. Goal Zone on Right Edge
    drawGoalZone(now);

    // 4. Bottom Spike Pit
    drawSpikePit();

    // 5. Drawn Ink Lines (Smooth Curves with Fade-out)
    drawInkStrokes(now);

    // 6. Player Ball & Motion Trail
    drawPlayerBall();

    // 7. Vector Burst Particles
    drawParticles();
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

  function drawGoalZone(now) {
    if (!goalZone) return;
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    const { x, y, width: gw, height: gh } = goalZone;
    const left = x - gw / 2;
    const top = y - gh / 2;

    ctx.save();
    ctx.strokeStyle = COLORS.goalAccent;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, gw, gh);

    // Inner pulsing vector frame
    const inset = 6 + pulse * 4;
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    ctx.strokeRect(left + inset, top + inset, gw - inset * 2, gh - inset * 2);

    // GOAL Label
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = COLORS.goalAccent;
    ctx.font = '700 11px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', x, top - 10);
    ctx.restore();
  }

  function drawSpikePit() {
    if (!spikeZone) return;
    const spikeWidth = 22;
    const spikeHeight = spikeZone.height;
    const baseY = height;
    const tipY = height - spikeHeight;

    ctx.save();
    ctx.fillStyle = COLORS.spikeFill;
    ctx.beginPath();
    for (let x = 0; x < width + spikeWidth; x += spikeWidth) {
      ctx.moveTo(x, baseY);
      ctx.lineTo(x + spikeWidth / 2, tipY);
      ctx.lineTo(x + spikeWidth, baseY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw Smooth Ink Curves with Individual Segment Lifetimes
   */
  function drawInkStrokes(now) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      const pts = stroke.points;
      if (pts.length < 2) continue;

      // Render smooth quadratic midpoint segments so curves look fluid and fade naturally per segment
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

        // Crisp inner core line
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

  function drawPlayerBall() {
    if (!playerBall) return;

    // Draw subtle motion trail
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

    // Outer solid ball
    ctx.fillStyle = COLORS.ballFill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner geometric line & core to show rolling spin clearly
    ctx.strokeStyle = '#1a1c23';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r + 3, 0);
    ctx.lineTo(r - 3, 0);
    ctx.stroke();

    ctx.fillStyle = COLORS.ballAccent;
    ctx.beginPath();
    ctx.arc(r * 0.42, 0, 3.5, 0, Math.PI * 2);
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

  quickResetBtn.addEventListener('click', () => {
    initGame();
  });

  retryBtn.addEventListener('click', () => {
    initGame();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      initGame();
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      initGame();
    }, 150);
  });

  // Boot Game
  initGame();
  requestAnimationFrame(loop);
})();
