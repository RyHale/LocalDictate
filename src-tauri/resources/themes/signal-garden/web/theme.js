const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const lifecycleHue = {
  idle: 188,
  arming: 48,
  listening: 168,
  transcribing: 258,
  processing: 315,
};

export function mount({ root, onSignal, getSignal }) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;pointer-events:none;";
  root.append(canvas);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Signal Garden needs Canvas 2D");

  let signal = getSignal();
  let animationFrame = 0;
  let previousTime = performance.now();
  let spawnCarry = 0;
  const motes = [];

  const unsubscribe = onSignal((nextSignal) => {
    signal = nextSignal;
  });

  const resize = () => {
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return { width, height };
  };

  const spawnMote = (width, height, current, phase) => {
    const hue =
      lifecycleHue[current.lifecycle] +
      (Math.random() - 0.5) * 54 +
      current.cadence * 28;
    const angle = phase + Math.random() * TAU;
    const launch = 12 + current.energy * 62 + Math.random() * 24;
    motes.push({
      x: width / 2 + Math.cos(phase * 0.7) * width * 0.12,
      y: height * 0.68 + Math.sin(phase * 0.9) * 8,
      vx: Math.cos(angle) * launch,
      vy: Math.sin(angle) * launch - 18 - current.energy * 35,
      age: 0,
      life: 0.8 + Math.random() * 1.8,
      size: 0.8 + Math.random() * (2.2 + current.energy * 3.6),
      hue,
      spin: (Math.random() - 0.5) * 3,
    });
  };

  const drawStem = (width, height, current, phase) => {
    const bands = current.spectrum;
    const hue = lifecycleHue[current.lifecycle];
    const baseY = height * 0.86;
    const topY = height * (0.3 - current.energy * 0.08);
    const sway = Math.sin(phase * 1.7) * (5 + current.cadence * 15);

    context.save();
    context.lineCap = "round";
    context.globalCompositeOperation = "lighter";
    context.shadowColor = `hsla(${hue}, 95%, 65%, 0.8)`;
    context.shadowBlur = 10 + current.energy * 18;

    for (let stem = -2; stem <= 2; stem += 1) {
      const offset = stem * (23 + current.energy * 9);
      context.beginPath();
      context.moveTo(width / 2 + offset * 0.45, baseY);
      for (let point = 1; point <= 16; point += 1) {
        const progress = point / 16;
        const band = bands[(point + stem + 32) % bands.length] || 0;
        const x =
          width / 2 +
          offset * (1 - progress * 0.35) +
          sway * progress +
          Math.sin(phase * 2.2 + point * 0.72 + stem) *
            (3 + band * 15) *
            progress;
        const y = baseY + (topY - baseY) * progress;
        context.lineTo(x, y);
      }
      context.strokeStyle = `hsla(${hue + stem * 19}, 96%, ${
        58 + current.energy * 18
      }%, ${0.28 + current.energy * 0.48})`;
      context.lineWidth = 1.2 + current.energy * 2.4;
      context.stroke();
    }
    context.restore();
  };

  const drawBloom = (width, height, current, phase) => {
    const hue = lifecycleHue[current.lifecycle];
    const centerX = width / 2 + Math.sin(phase * 1.7) * current.cadence * 14;
    const centerY = height * (0.3 - current.energy * 0.08);
    const petals = 7 + Math.round(current.cadence * 7);
    const radius = 18 + current.energy * 42;

    context.save();
    context.translate(centerX, centerY);
    context.rotate(phase * (0.12 + current.cadence * 0.28));
    context.globalCompositeOperation = "lighter";
    context.shadowBlur = 18 + current.energy * 26;
    context.shadowColor = `hsl(${hue + 45}, 100%, 65%)`;

    for (let petal = 0; petal < petals; petal += 1) {
      const angle = (petal / petals) * TAU;
      const band = current.spectrum[petal % current.spectrum.length] || 0;
      const length = radius * (0.65 + band * 0.85);
      context.save();
      context.rotate(angle);
      const gradient = context.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.12)`);
      gradient.addColorStop(
        1,
        `hsla(${hue + petal * 11}, 100%, 68%, ${0.28 + current.energy * 0.62})`,
      );
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(0, 0);
      context.quadraticCurveTo(length * 0.58, -7 - band * 11, length, 0);
      context.quadraticCurveTo(length * 0.58, 7 + band * 11, 0, 0);
      context.fill();
      context.restore();
    }

    context.fillStyle = `hsla(${hue + 58}, 100%, 75%, ${
      0.62 + current.energy * 0.38
    })`;
    context.beginPath();
    context.arc(0, 0, 3 + current.energy * 8, 0, TAU);
    context.fill();
    context.restore();
  };

  const drawMotes = (deltaSeconds, width, height) => {
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let index = motes.length - 1; index >= 0; index -= 1) {
      const mote = motes[index];
      mote.age += deltaSeconds;
      if (mote.age >= mote.life) {
        motes.splice(index, 1);
        continue;
      }
      mote.vx += Math.sin(mote.age * 4 + mote.spin) * 5 * deltaSeconds;
      mote.vy += 8 * deltaSeconds;
      mote.x += mote.vx * deltaSeconds;
      mote.y += mote.vy * deltaSeconds;
      const remaining = 1 - mote.age / mote.life;
      context.fillStyle = `hsla(${mote.hue}, 100%, 70%, ${remaining * 0.82})`;
      context.shadowColor = `hsl(${mote.hue}, 100%, 64%)`;
      context.shadowBlur = 8;
      context.beginPath();
      context.arc(
        clamp(mote.x, -30, width + 30),
        clamp(mote.y, -30, height + 30),
        mote.size * remaining,
        0,
        TAU,
      );
      context.fill();
    }
    context.restore();
  };

  const render = (now) => {
    const { width, height } = resize();
    const deltaSeconds = Math.min(
      0.05,
      Math.max(0, (now - previousTime) / 1000),
    );
    previousTime = now;
    context.clearRect(0, 0, width, height);

    const current = signal || {
      lifecycle: "idle",
      energy: 0,
      cadence: 0,
      voiceActivity: false,
      spectrum: Array(16).fill(0),
    };
    const phase = now / 1000;
    const activeBoost = current.voiceActivity ? 1 : 0.22;
    spawnCarry +=
      deltaSeconds *
      (4 + current.energy * 105 + current.cadence * 42) *
      activeBoost;
    while (spawnCarry >= 1 && motes.length < 260) {
      spawnMote(width, height, current, phase);
      spawnCarry -= 1;
    }

    drawStem(width, height, current, phase);
    drawBloom(width, height, current, phase);
    drawMotes(deltaSeconds, width, height);
    animationFrame = requestAnimationFrame(render);
  };

  animationFrame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(animationFrame);
    unsubscribe();
    canvas.remove();
  };
}
