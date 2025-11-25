
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";

// --- Game Constants ---
const GRAVITY = 0.4;
const JUMP_STRENGTH = -7;
const PIPE_WIDTH = 70; 
const BIRD_RADIUS = 24; 

// --- Level Configuration Types ---
type LevelDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

const LEVEL_CONFIGS: Record<LevelDifficulty, {
  pipeSpeed: number;
  pipeSpawnRate: number;
  pipeGap: number;
  winScore: number;
  label: string;
  color: string;
}> = {
  EASY: { 
      pipeSpeed: 3.0, 
      pipeSpawnRate: 130, 
      pipeGap: 200, 
      winScore: 10, 
      label: 'Easy',
      color: '#66bb6a' // Green
  },
  MEDIUM: { 
      pipeSpeed: 3.8, 
      pipeSpawnRate: 110, 
      pipeGap: 170, 
      winScore: 10, 
      label: 'Medium',
      color: '#ffa726' // Orange
  },
  HARD: { 
      pipeSpeed: 5.0, 
      pipeSpawnRate: 90, 
      pipeGap: 150, 
      winScore: 10, 
      label: 'Hard',
      color: '#ef5350' // Red
  }
};

// --- Audio System (Synthesized Sounds) ---
let sharedAudioCtx: AudioContext | null = null;

const getAudioContext = () => {
  if (!sharedAudioCtx) {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      sharedAudioCtx = new AudioContext();
    }
  }
  return sharedAudioCtx;
};

const playSound = (type: 'jump' | 'score' | 'crash' | 'win' | 'explode') => {
  const ctx = getAudioContext();
  if (!ctx) return;
  
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);

  if (type === 'jump') {
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(500, now + 0.1);
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.linearRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);

  } else if (type === 'score') {
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.setValueAtTime(1800, now + 0.05); 
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);

  } else if (type === 'crash') {
    // 1. The "Smack"
    const bufferSize = ctx.sampleRate * 0.1; 
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.8; 
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    noise.start(now);

    // 2. The "Fall"
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = 'triangle'; 
    osc.frequency.setValueAtTime(800, now + 0.05); 
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.5); 
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.setValueAtTime(0.4, now + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
    
    osc.start(now);
    osc.stop(now + 0.5);
  } else if (type === 'win') {
    // Victory Fanfare
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = 'triangle';
    
    // Simple Arpeggio: C - E - G - C
    osc.frequency.setValueAtTime(523.25, now);       // C5
    osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
    osc.frequency.setValueAtTime(783.99, now + 0.30); // G5
    osc.frequency.setValueAtTime(1046.50, now + 0.45); // C6
    
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.setValueAtTime(0.2, now + 0.6);
    gainNode.gain.linearRampToValueAtTime(0, now + 2.0);

    osc.start(now);
    osc.stop(now + 2.0);
  } else if (type === 'explode') {
      // Firework sound
      const bufferSize = ctx.sampleRate * 0.2; 
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.5; 
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = ctx.createGain();
      noise.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noiseGain.gain.setValueAtTime(0.3, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      noise.start(now);
  }
};


// --- Assets / Drawing Helpers ---

const drawBird = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const s = 1.2;
  ctx.scale(s, s);

  // Body
  const grad = ctx.createRadialGradient(-5, -5, 5, 0, 0, 20);
  grad.addColorStop(0, '#fff176'); 
  grad.addColorStop(0.3, '#fdd835'); 
  grad.addColorStop(1, '#fbc02d'); 
  ctx.fillStyle = grad;
  
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();

  // Eye Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.arc(10, -8, 9, 0, Math.PI * 2);
  ctx.fill();

  // Big Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(8, -10, 8, 10, 0, 0, Math.PI * 2); 
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(18, -10, 7, 9, 0, 0, Math.PI * 2); 
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(10, -10, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(19, -10, 2.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Eye shine
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(11, -12, 1, 0, Math.PI * 2);
  ctx.fill();

  // Wing
  ctx.fillStyle = '#ffb300';
  ctx.beginPath();
  ctx.ellipse(-12, 5, 8, 5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f57f17';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Beak
  ctx.fillStyle = '#ff7043'; 
  ctx.beginPath();
  ctx.ellipse(10, 8, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mouth line
  ctx.beginPath();
  ctx.moveTo(2, 8);
  ctx.quadraticCurveTo(10, 10, 18, 8);
  ctx.strokeStyle = '#bf360c';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
};

const drawCrow = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, frame: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // Crows in background fly left, face left
  ctx.scale(-1, 1);

  // Flap animation
  const flap = Math.sin(frame * 0.15);
  const wingY = flap * 12;

  // Colors
  const bodyColor = '#37474f';
  const beakTop = '#ffca28';
  const beakBottom = '#f57f17';
  const legColor = '#ffb74d';

  // Legs (tucked)
  ctx.fillStyle = legColor;
  ctx.beginPath();
  ctx.moveTo(2, 12);
  ctx.lineTo(-2, 18);
  ctx.lineTo(6, 18);
  ctx.fill();

  // Body (Low poly geometric shape)
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(-20, 0); // Tail
  ctx.lineTo(0, -14); // Back
  ctx.lineTo(20, -5); // Neck
  ctx.lineTo(15, 15); // Chest
  ctx.lineTo(-10, 10); // Belly
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.moveTo(15, -10);
  ctx.lineTo(25, -16); // Top head
  ctx.lineTo(32, -5); // Beak base
  ctx.lineTo(25, 5); // Chin
  ctx.lineTo(15, 0); // Neck join
  ctx.fill();

  // Beak
  ctx.fillStyle = beakTop;
  ctx.beginPath();
  ctx.moveTo(30, -8);
  ctx.lineTo(48, -2); // Tip
  ctx.lineTo(30, 0);
  ctx.fill();

  ctx.fillStyle = beakBottom;
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(46, -2);
  ctx.lineTo(30, 5);
  ctx.fill();

  // Eye
  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.arc(24, -9, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(25, -10, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Wing (Flapping)
  ctx.fillStyle = '#263238'; // Darker wing
  ctx.beginPath();
  ctx.moveTo(5, -5);
  ctx.lineTo(20, -10);
  ctx.lineTo(0, -20 + wingY);
  ctx.lineTo(-25, -10 + wingY * 0.5);
  ctx.fill();

  ctx.restore();
};

const drawBoss = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.save();
  ctx.translate(x, y);
  const s = 1.5;
  ctx.scale(s, s);

  // Body (Red/Angry)
  const grad = ctx.createRadialGradient(-10, -10, 10, 0, 0, 40);
  grad.addColorStop(0, '#ef5350');
  grad.addColorStop(1, '#c62828');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b71c1c';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Angry Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(-15, -10, 12, 0, Math.PI * 2);
  ctx.arc(15, -10, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.arc(-15, -10, 4, 0, Math.PI * 2);
  ctx.arc(15, -10, 4, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.beginPath();
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'black';
  // Left brow
  ctx.moveTo(-28, -25);
  ctx.lineTo(-5, -5);
  // Right brow
  ctx.moveTo(5, -5);
  ctx.lineTo(28, -25);
  ctx.stroke();

  // Beak
  ctx.fillStyle = '#fbc02d';
  ctx.beginPath();
  ctx.moveTo(-10, 10);
  ctx.lineTo(10, 10);
  ctx.lineTo(0, 25);
  ctx.fill();

  ctx.restore();
};

const drawPipe = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, isTop: boolean) => {
  const capHeight = 35;
  
  const grad = ctx.createLinearGradient(x, 0, x + width, 0);
  grad.addColorStop(0, '#2e7d32'); 
  grad.addColorStop(0.1, '#66bb6a'); 
  grad.addColorStop(0.4, '#a5d6a7'); 
  grad.addColorStop(0.8, '#43a047'); 
  grad.addColorStop(1, '#1b5e20'); 

  ctx.fillStyle = grad;
  ctx.fillRect(x, y, width, height);

  ctx.strokeStyle = '#1b5e20';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);

  const capY = isTop ? y + height - capHeight : y;
  
  const capGrad = ctx.createLinearGradient(x - 6, 0, x + width + 6, 0);
  capGrad.addColorStop(0, '#2e7d32');
  capGrad.addColorStop(0.1, '#66bb6a');
  capGrad.addColorStop(0.4, '#a5d6a7'); 
  capGrad.addColorStop(0.8, '#43a047');
  capGrad.addColorStop(1, '#1b5e20');

  ctx.fillStyle = capGrad;
  ctx.fillRect(x - 6, capY, width + 12, capHeight);
  ctx.strokeRect(x - 6, capY, width + 12, capHeight);
  
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  if (isTop) {
      ctx.fillRect(x - 6, capY + capHeight - 5, width + 12, 5);
  } else {
      ctx.fillRect(x - 6, capY, width + 12, 5);
  }
};

const drawCloud = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  
  ctx.fillStyle = 'white';
  
  ctx.shadowColor = 'rgba(0, 70, 100, 0.1)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;

  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.arc(30, -10, 35, 0, Math.PI * 2);
  ctx.arc(60, 0, 25, 0, Math.PI * 2);
  ctx.arc(80, -15, 20, 0, Math.PI * 2);
  ctx.arc(40, -25, 30, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.shadowColor = 'transparent';
  
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createLinearGradient(0, -50, 0, 50);
  grad.addColorStop(0, 'white');
  grad.addColorStop(1, '#e1f5fe');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.restore();
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const drawFirework = (ctx: CanvasRenderingContext2D, p: Particle) => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
};

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'LANDING' | 'PLAYING' | 'GAME_OVER' | 'WON'>('LANDING');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [commentary, setCommentary] = useState<string>("");
  const [loadingCommentary, setLoadingCommentary] = useState(false);
  
  // Level Management
  const [selectedLevel, setSelectedLevel] = useState<LevelDifficulty>('EASY');
  const gameConfig = useRef(LEVEL_CONFIGS['EASY']);

  // Game State Refs
  const birdY = useRef(300);
  const birdVelocity = useRef(0);
  const birdRotation = useRef(0);
  const pipes = useRef<Array<{ x: number, topHeight: number, passed: boolean }>>([]);
  const frameCount = useRef(0);
  const clouds = useRef<Array<{ x: number, y: number, scale: number, speed: number }>>([]);
  const crows = useRef<Array<{ x: number, y: number, scale: number, speed: number, frameOffset: number }>>([]);
  const boss = useRef<{ x: number, y: number, active: boolean, passed: boolean }>({ x: 0, y: 0, active: false, passed: false });
  const fireworks = useRef<Particle[]>([]);
  const animationFrameId = useRef<number>(0);

  // Initialize Clouds, Crows & High Score
  useEffect(() => {
    clouds.current = [];
    crows.current = [];
    
    // Init Clouds
    for(let i=0; i<6; i++) {
        clouds.current.push({
            x: Math.random() * window.innerWidth,
            y: Math.random() * (window.innerHeight / 2),
            scale: 0.5 + Math.random() * 0.8,
            speed: 0.2 + Math.random() * 0.3
        });
    }

    // Init Crows
    for(let i=0; i<3; i++) {
      crows.current.push({
        x: Math.random() * window.innerWidth,
        y: 50 + Math.random() * (window.innerHeight / 3),
        scale: 0.6 + Math.random() * 0.4,
        speed: 1.5 + Math.random() * 1.5, // Faster than clouds, slower than pipes usually
        frameOffset: Math.random() * 100
      });
    }

    const storedHighScore = localStorage.getItem('flappyBirdGHighScore');
    if (storedHighScore) setHighScore(parseInt(storedHighScore, 10));
  }, []);

  // Gemini Commentary
  const fetchCommentary = useCallback(async (finalScore: number) => {
    setLoadingCommentary(true);
    setCommentary("");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `You are the sarcastic announcer of a Flappy Bird style game. 
      The player just died on ${selectedLevel} mode.
      Score: ${finalScore}. 
      Give a one-sentence, funny, roasting commentary.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      setCommentary(response.text || "Oof. That was... something.");
    } catch (error) {
      console.error("Gemini Error:", error);
      setCommentary("My AI brain is offline. But you still lost.");
    } finally {
      setLoadingCommentary(false);
    }
  }, [selectedLevel]);

  const resetGame = () => {
    birdY.current = window.innerHeight / 2;
    birdVelocity.current = 0;
    birdRotation.current = 0;
    pipes.current = [];
    frameCount.current = 0;
    boss.current = { x: window.innerWidth + 200, y: window.innerHeight / 2, active: false, passed: false };
    fireworks.current = [];
    setScore(0);
    setGameState('LANDING'); 
  };

  const goToLanding = () => {
      resetGame();
      setGameState('LANDING');
  }

  const startGame = () => {
    gameConfig.current = LEVEL_CONFIGS[selectedLevel];
    resetGame();
    setGameState('PLAYING');
    jump();
  };

  const jump = useCallback(() => {
    if (gameState === 'PLAYING') {
      birdVelocity.current = JUMP_STRENGTH;
      playSound('jump');
    } 
  }, [gameState]);

  const gameWin = () => {
    setGameState('WON');
    playSound('win');
    // Don't cancel animation frame, keep loop running for fireworks
    const finalScore = gameConfig.current.winScore + 1; // Bonus for beating boss
    setScore(finalScore);
    const newHighScore = Math.max(finalScore, highScore);
    setHighScore(newHighScore);
    localStorage.setItem('flappyBirdGHighScore', newHighScore.toString());
  };

  // Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeHandler = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeHandler);
    resizeHandler();

    const createExplosion = (x: number, y: number) => {
      for (let i = 0; i < 25; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        fireworks.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          color: ['#fdd835', '#ef5350', '#ffffff', '#ff9800'][Math.floor(Math.random() * 4)]
        });
      }
    };

    const loop = () => {
      // 1. Logic
      if (gameState === 'PLAYING') {
        const config = gameConfig.current;

        birdVelocity.current += GRAVITY;
        birdY.current += birdVelocity.current;
        
        // Rotation logic
        const targetRotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (birdVelocity.current * 0.1)));
        birdRotation.current += (targetRotation - birdRotation.current) * 0.2; // Smooth rotation

        frameCount.current++;

        // Boss Spawning
        if (score >= config.winScore && !boss.current.active && !boss.current.passed) {
             boss.current.active = true;
             boss.current.x = canvas.width + 100;
             boss.current.y = canvas.height / 2;
        }

        // Spawn Pipes (Only if boss is not active/about to spawn)
        if (score < config.winScore && frameCount.current % config.pipeSpawnRate === 0) {
          const minHeight = 80;
          const maxHeight = canvas.height - config.pipeGap - minHeight - 60; 
          const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
          pipes.current.push({ x: canvas.width, topHeight, passed: false });
        }

        // Move Pipes
        pipes.current.forEach(pipe => {
          pipe.x -= config.pipeSpeed;
        });

        // Cleanup Pipes
        if (pipes.current.length > 0 && pipes.current[0].x + PIPE_WIDTH < -100) {
          pipes.current.shift();
        }

        // Boss Logic
        if (boss.current.active) {
            // Move Boss Left
            boss.current.x -= (config.pipeSpeed * 0.7); 
            // Move Boss Up/Down (Sine wave)
            boss.current.y = (canvas.height / 2) + Math.sin(frameCount.current * 0.05) * 150;

            // Draw Boss is in Render step, check collision here
            const bossRadius = 40; // Approx matching drawBoss
            const dx = (canvas.width / 2) - boss.current.x;
            const dy = birdY.current - boss.current.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < BIRD_RADIUS + bossRadius - 10) { // -10 slightly forgiving hitbox
                createExplosion(canvas.width / 2, birdY.current);
                gameOver();
                return;
            }

            // Win Condition
            if (!boss.current.passed && boss.current.x < (canvas.width / 2) - 100) {
                boss.current.passed = true;
                gameWin();
                return;
            }
        }

        // Collision & Scoring
        const birdLeft = canvas.width / 2 - BIRD_RADIUS + 8;
        const birdRight = canvas.width / 2 + BIRD_RADIUS - 8;
        const birdTop = birdY.current - BIRD_RADIUS + 8;
        const birdBottom = birdY.current + BIRD_RADIUS - 8;

        if (birdBottom >= canvas.height - 20 || birdTop <= -50) { 
           createExplosion(canvas.width / 2, birdY.current);
           gameOver();
           return; 
        }

        pipes.current.forEach(pipe => {
          if (birdRight > pipe.x && birdLeft < pipe.x + PIPE_WIDTH) {
             if (birdTop < pipe.topHeight || birdBottom > pipe.topHeight + config.pipeGap) {
                 createExplosion(canvas.width / 2, birdY.current);
                 gameOver();
                 return;
             }
          }
          if (!pipe.passed && birdLeft > pipe.x + PIPE_WIDTH) {
              pipe.passed = true;
              setScore(s => s + 1);
              playSound('score');
          }
        });
      } else if (gameState === 'LANDING') {
          // Hover effect in landing
          birdY.current = canvas.height/2 + Math.sin(Date.now() / 300) * 15;
          birdRotation.current = Math.sin(Date.now() / 400) * 0.1;
          frameCount.current++; // Keep bg animating
      } else if (gameState === 'WON') {
          // Fireworks Logic
          if (Math.random() < 0.1) {
              const cx = Math.random() * canvas.width;
              const cy = Math.random() * (canvas.height / 2);
              const color = `hsl(${Math.random() * 360}, 100%, 50%)`;
              playSound('explode');
              for(let i=0; i<30; i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const speed = Math.random() * 5 + 2;
                  fireworks.current.push({
                      x: cx, y: cy,
                      vx: Math.cos(angle) * speed,
                      vy: Math.sin(angle) * speed,
                      life: 1.0,
                      color: color
                  });
              }
          }
      }

      // Update Particles (for both WON and GAME_OVER explosions)
      if (gameState === 'WON' || gameState === 'GAME_OVER') {
        for (let i = fireworks.current.length - 1; i >= 0; i--) {
            const p = fireworks.current[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1; // gravity
            p.life -= 0.02;
            if (p.life <= 0) {
                fireworks.current.splice(i, 1);
            }
        }
      }

      // Background Objects (Always move)
      clouds.current.forEach(cloud => {
          cloud.x -= cloud.speed;
          if (cloud.x < -150) {
              cloud.x = canvas.width + 150;
              cloud.y = Math.random() * (canvas.height / 2);
          }
      });

      crows.current.forEach(crow => {
        crow.x -= crow.speed;
        if (crow.x < -100) {
          crow.x = canvas.width + 100 + Math.random() * 200;
          crow.y = 50 + Math.random() * (canvas.height / 3);
          crow.speed = 1.5 + Math.random() * 1.5;
        }
      });

      // 2. Render
      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      skyGrad.addColorStop(0, '#4fc3f7');
      skyGrad.addColorStop(1, '#b3e5fc');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Clouds
      clouds.current.forEach(cloud => drawCloud(ctx, cloud.x, cloud.y, cloud.scale));

      // Crows (Background)
      crows.current.forEach(crow => drawCrow(ctx, crow.x, crow.y, crow.scale, frameCount.current + crow.frameOffset));

      // Pipes
      pipes.current.forEach(pipe => {
        const gap = gameConfig.current.pipeGap;
        drawPipe(ctx, pipe.x, 0, PIPE_WIDTH, pipe.topHeight, true);
        drawPipe(ctx, pipe.x, pipe.topHeight + gap, PIPE_WIDTH, canvas.height, false);
      });

      // Boss
      if (boss.current.active) {
          drawBoss(ctx, boss.current.x, boss.current.y);
      }

      // Ground
      ctx.fillStyle = '#d7ccc8';
      ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
      
      // Grass Top
      ctx.fillStyle = '#8bc34a';
      ctx.fillRect(0, canvas.height - 25, canvas.width, 10);
      ctx.strokeStyle = '#558b2f';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height - 25);
      ctx.lineTo(canvas.width, canvas.height - 25);
      ctx.stroke();

      // Bird
      if (gameState !== 'WON') {
          drawBird(ctx, canvas.width / 2, birdY.current, birdRotation.current);
      }

      // Fireworks / Explosion
      if (gameState === 'WON' || gameState === 'GAME_OVER') {
          fireworks.current.forEach(p => drawFirework(ctx, p));
      }

      animationFrameId.current = requestAnimationFrame(loop);
    };

    const gameOver = () => {
        playSound('crash');
        setGameState('GAME_OVER');
        cancelAnimationFrame(animationFrameId.current);
        setScore(currentScore => {
            const newHighScore = Math.max(currentScore, highScore);
            setHighScore(newHighScore);
            localStorage.setItem('flappyBirdGHighScore', newHighScore.toString());
            fetchCommentary(currentScore);
            return currentScore;
        });
    };

    animationFrameId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', resizeHandler);
      cancelAnimationFrame(animationFrameId.current);
    };
  }, [gameState, highScore, fetchCommentary, score]); 

  // Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (gameState === 'GAME_OVER' || gameState === 'WON') startGame();
        else if (gameState === 'LANDING') startGame();
        else jump();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jump, gameState, selectedLevel]); // selectedLevel added just in case but referenced via startGame

  return (
    <div 
        style={{ width: '100vw', height: '100vh', overflow: 'hidden', touchAction: 'none' }}
        onPointerDown={(e) => {
             e.preventDefault();
             if (gameState === 'GAME_OVER' || gameState === 'WON') {
                 // Do nothing here, let the button handle it
             }
             else if (gameState === 'LANDING') {
                // Do nothing here, let button handle it
             }
             else jump();
        }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* UI Layer */}
      <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Segoe UI, sans-serif', textShadow: '0px 2px 4px rgba(0,0,0,0.3)'
      }}>
          <style>
              {`
              @keyframes titleFloat {
                  0%, 100% { transform: translateY(0); }
                  50% { transform: translateY(-15px); }
              }
              @keyframes popIn {
                  0% { transform: scale(0); opacity: 0; }
                  80% { transform: scale(1.1); opacity: 1; }
                  100% { transform: scale(1); opacity: 1; }
              }
              @keyframes glowPulse {
                  0% { text-shadow: 0 0 10px #ffd700, 0 0 20px #ffd700; }
                  50% { text-shadow: 0 0 30px #ffea00, 0 0 50px #ffea00; }
                  100% { text-shadow: 0 0 10px #ffd700, 0 0 20px #ffd700; }
              }
              .start-btn:hover {
                  transform: scale(1.05);
                  filter: brightness(1.1);
              }
              .level-btn {
                  transition: all 0.2s ease;
                  opacity: 0.7;
                  transform: scale(0.95);
              }
              .level-btn.active {
                  opacity: 1;
                  transform: scale(1.1);
                  box-shadow: 0 0 15px rgba(255,255,255,0.6);
                  z-index: 2;
              }
              .level-btn:hover {
                  opacity: 1;
                  transform: scale(1.05);
              }
              `}
          </style>

          {gameState === 'PLAYING' && (
              <div style={{ position: 'absolute', top: '10%', fontSize: '4rem', fontWeight: '900', color: 'white', zIndex: 10 }}>
                  {score}
              </div>
          )}

          {gameState === 'LANDING' && (
              <div style={{ 
                  textAlign: 'center', 
                  pointerEvents: 'auto',
                  display: 'flex', flexDirection: 'column', alignItems: 'center'
              }}>
                  <div style={{
                      fontSize: '5rem', fontWeight: '900', lineHeight: '1.1',
                      color: '#ffb300', 
                      textTransform: 'uppercase',
                      fontFamily: '"Arial Black", Gadget, sans-serif',
                      textShadow: `
                        0 1px 0 #c62828,
                        0 2px 0 #c62828,
                        0 3px 0 #c62828,
                        0 4px 0 #c62828,
                        0 5px 0 #c62828,
                        0 6px 1px rgba(0,0,0,.1),
                        0 0 5px rgba(0,0,0,.1),
                        0 1px 3px rgba(0,0,0,.3),
                        0 3px 5px rgba(0,0,0,.2),
                        0 5px 10px rgba(0,0,0,.25),
                        0 10px 10px rgba(0,0,0,.2),
                        0 20px 20px rgba(0,0,0,.15)
                      `,
                      animation: 'titleFloat 3s ease-in-out infinite',
                      marginBottom: '1rem'
                  }}>
                      FLAPPY<br/>BIRD
                  </div>

                  {/* Level Selector */}
                  <div style={{ 
                      display: 'flex', 
                      gap: '15px', 
                      background: 'rgba(255,255,255,0.2)', 
                      padding: '10px 20px', 
                      borderRadius: '50px',
                      marginBottom: '2rem',
                      backdropFilter: 'blur(4px)'
                  }}>
                      {(['EASY', 'MEDIUM', 'HARD'] as LevelDifficulty[]).map((level) => (
                          <button
                              key={level}
                              onClick={() => setSelectedLevel(level)}
                              className={`level-btn ${selectedLevel === level ? 'active' : ''}`}
                              style={{
                                  background: LEVEL_CONFIGS[level].color,
                                  border: 'none',
                                  padding: '10px 20px',
                                  borderRadius: '20px',
                                  color: 'white',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  textTransform: 'uppercase',
                                  fontSize: '0.9rem',
                                  borderBottom: selectedLevel === level ? 'none' : '4px solid rgba(0,0,0,0.2)'
                              }}
                          >
                              {LEVEL_CONFIGS[level].label}
                          </button>
                      ))}
                  </div>

                  <button 
                    onClick={startGame}
                    className="start-btn"
                    style={{
                        background: 'linear-gradient(to bottom, #66bb6a 0%, #43a047 100%)',
                        border: 'none',
                        padding: '20px 60px',
                        borderRadius: '50px',
                        color: 'white',
                        fontSize: '2rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        boxShadow: '0 6px 0 #1b5e20, 0 15px 20px rgba(0,0,0,0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        transition: 'transform 0.1s',
                        textShadow: '0 2px 0 rgba(0,0,0,0.2)'
                    }}
                    onMouseDown={(e) => {
                        e.currentTarget.style.transform = 'translateY(6px)';
                        e.currentTarget.style.boxShadow = '0 0 0 #1b5e20, 0 0 0 rgba(0,0,0,0)';
                    }}
                    onMouseUp={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 6px 0 #1b5e20, 0 15px 20px rgba(0,0,0,0.4)';
                    }}
                  >
                      Start Game
                  </button>
              </div>
          )}

          {gameState === 'GAME_OVER' && (
              <div style={{ textAlign: 'center', pointerEvents: 'auto', background: 'rgba(255, 255, 255, 0.9)', padding: '2rem', borderRadius: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                  <h1 style={{ color: '#d32f2f', margin: '0 0 1rem 0', fontSize: '3rem' }}>GAME OVER</h1>
                  <div style={{ fontSize: '1.5rem', color: '#555', marginBottom: '1.5rem' }}>
                      Score: <strong>{score}</strong> <br/>
                      Best: <strong>{highScore}</strong>
                  </div>
                  
                  {loadingCommentary ? (
                      <div style={{ fontStyle: 'italic', color: '#777', marginBottom: '2rem' }}>Loading insult...</div>
                  ) : (
                      <div style={{ 
                          fontSize: '1.2rem', 
                          color: '#333', 
                          background: '#f0f0f0', 
                          padding: '1rem', 
                          borderRadius: '10px',
                          marginBottom: '2rem',
                          maxWidth: '300px',
                          fontStyle: 'italic',
                          borderLeft: '5px solid #ffb300'
                      }}>
                          "{commentary}"
                      </div>
                  )}

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                      <button onClick={startGame} style={{
                          background: '#4fc3f7', border: 'none', padding: '15px 30px',
                          borderRadius: '30px', color: 'white', fontSize: '1.2rem',
                          cursor: 'pointer', fontWeight: 'bold'
                      }}>
                          Try Again
                      </button>
                      <button onClick={goToLanding} style={{
                          background: '#e0e0e0', border: 'none', padding: '15px 30px',
                          borderRadius: '30px', color: '#555', fontSize: '1.2rem',
                          cursor: 'pointer', fontWeight: 'bold'
                      }}>
                          Menu
                      </button>
                  </div>
              </div>
          )}

          {gameState === 'WON' && (
              <div style={{ 
                  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                  background: 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(20,20,50,0.9))',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'auto',
                  animation: 'popIn 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
              }}>
                  <div style={{
                      fontSize: '6rem', 
                      color: '#ffd700', 
                      fontWeight: '900', 
                      textTransform: 'uppercase',
                      fontFamily: 'Impact, sans-serif',
                      letterSpacing: '5px',
                      marginBottom: '20px',
                      animation: 'glowPulse 2s infinite'
                  }}>
                      VICTORY!
                  </div>
                  <div style={{ fontSize: '2rem', color: '#fff', marginBottom: '3rem', textAlign: 'center' }}>
                      You Defeated The Boss!<br/>
                      <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>Difficulty: {LEVEL_CONFIGS[selectedLevel].label}</span><br/>
                      <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>Score: {score}</span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                      <button onClick={startGame} style={{
                          background: 'linear-gradient(to right, #fbc02d, #f57f17)', 
                          border: 'none', padding: '20px 50px',
                          borderRadius: '50px', color: '#000', fontSize: '1.5rem',
                          cursor: 'pointer', fontWeight: '900', 
                          boxShadow: '0 0 20px rgba(255, 215, 0, 0.6)',
                          textTransform: 'uppercase'
                      }}>
                          Play Again
                      </button>
                      <button onClick={goToLanding} style={{
                          background: 'rgba(255,255,255,0.2)', 
                          border: '2px solid rgba(255,255,255,0.5)', 
                          padding: '20px 40px',
                          borderRadius: '50px', color: '#fff', fontSize: '1.2rem',
                          cursor: 'pointer', fontWeight: 'bold',
                          backdropFilter: 'blur(5px)'
                      }}>
                          Menu
                      </button>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
}
