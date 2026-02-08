import { useEffect, useRef, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Trophy, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTetrisSounds } from '@/hooks/useTetrisSounds';
import { useIsMobile } from '@/hooks/use-mobile';

const STORAGE_KEY = 'tetris-high-scores';
const MAX_HIGH_SCORES = 5;

interface HighScore {
  name: string;
  score: number;
  level: number;
  date: string;
}

const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE_DESKTOP = 30;
const BLOCK_SIZE_MOBILE = 20;

const COLORS = [
  '#00f0f0', // I - cyan
  '#f0f000', // O - yellow
  '#a000f0', // T - purple
  '#00f000', // S - green
  '#f00000', // Z - red
  '#0000f0', // J - blue
  '#f0a000', // L - orange
];

const SHAPES = [
  [[1, 1, 1, 1]], // I
  [[1, 1], [1, 1]], // O
  [[0, 1, 0], [1, 1, 1]], // T
  [[0, 1, 1], [1, 1, 0]], // S
  [[1, 1, 0], [0, 1, 1]], // Z
  [[1, 0, 0], [1, 1, 1]], // J
  [[0, 0, 1], [1, 1, 1]], // L
];

interface Piece {
  shape: number[][];
  color: string;
  x: number;
  y: number;
}

const Tetris = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();
  const blockSize = isMobile ? BLOCK_SIZE_MOBILE : BLOCK_SIZE_DESKTOP;
  
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [highScores, setHighScores] = useState<HighScore[]>([]);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [playerName, setPlayerName] = useState(['A', 'A', 'A']);
  const [activeLetterIndex, setActiveLetterIndex] = useState(0);
  
  const { 
    soundEnabled, 
    toggleSound, 
    playMove, 
    playRotate, 
    playDrop, 
    playLineClear, 
    playGameOver, 
    startMusic, 
    stopMusic 
  } = useTetrisSounds();
  
  const boardRef = useRef<(string | null)[][]>(
    Array(ROWS).fill(null).map(() => Array(COLS).fill(null))
  );
  const currentPieceRef = useRef<Piece | null>(null);
  const lastDropRef = useRef(0);
  const animationRef = useRef<number>(0);
  const scoreRef = useRef(0);
  const levelRef = useRef(1);
  const isPausedRef = useRef(false);
  const gameOverRef = useRef(false);
  
  // Touch gesture tracking
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const SWIPE_THRESHOLD = 30; // minimum distance for swipe
  const TAP_THRESHOLD = 10; // maximum distance for tap
  const TAP_TIME_THRESHOLD = 200; // maximum time for tap (ms)

  const createPiece = useCallback((): Piece => {
    const index = Math.floor(Math.random() * SHAPES.length);
    return {
      shape: SHAPES[index].map(row => [...row]),
      color: COLORS[index],
      x: Math.floor(COLS / 2) - Math.floor(SHAPES[index][0].length / 2),
      y: 0,
    };
  }, []);

  const isValidMove = useCallback((piece: Piece, offsetX: number, offsetY: number, newShape?: number[][]): boolean => {
    const shape = newShape || piece.shape;
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        if (shape[row][col]) {
          const newX = piece.x + col + offsetX;
          const newY = piece.y + row + offsetY;
          if (newX < 0 || newX >= COLS || newY >= ROWS) return false;
          if (newY >= 0 && boardRef.current[newY][newX]) return false;
        }
      }
    }
    return true;
  }, []);

  const rotatePiece = useCallback((piece: Piece): number[][] => {
    const rotated = piece.shape[0].map((_, i) =>
      piece.shape.map(row => row[i]).reverse()
    );
    return rotated;
  }, []);

  const tryRotateWithWallKick = useCallback((piece: Piece): boolean => {
    const rotated = rotatePiece(piece);
    
    // Try normal rotation first
    if (isValidMove(piece, 0, 0, rotated)) {
      piece.shape = rotated;
      return true;
    }
    
    // Wall kicks: try shifting left/right by 1 or 2
    for (const kick of [1, -1, 2, -2]) {
      if (isValidMove(piece, kick, 0, rotated)) {
        piece.shape = rotated;
        piece.x += kick;
        return true;
      }
    }
    
    return false;
  }, [rotatePiece, isValidMove]);

  const lockPiece = useCallback((piece: Piece) => {
    for (let row = 0; row < piece.shape.length; row++) {
      for (let col = 0; col < piece.shape[row].length; col++) {
        if (piece.shape[row][col]) {
          const y = piece.y + row;
          const x = piece.x + col;
          if (y >= 0) {
            boardRef.current[y][x] = piece.color;
          }
        }
      }
    }
  }, []);

  const clearLines = useCallback(() => {
    let linesCleared = 0;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (boardRef.current[row].every(cell => cell !== null)) {
        boardRef.current.splice(row, 1);
        boardRef.current.unshift(Array(COLS).fill(null));
        linesCleared++;
        row++;
      }
    }
    if (linesCleared > 0) {
      playLineClear(linesCleared);
      const points = [0, 100, 300, 500, 800][linesCleared] * levelRef.current;
      scoreRef.current += points;
      setScore(scoreRef.current);
      
      const newLevel = Math.floor(scoreRef.current / 1000) + 1;
      if (newLevel !== levelRef.current) {
        levelRef.current = newLevel;
        setLevel(newLevel);
      }
    }
  }, [playLineClear]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#2a2a4e';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * blockSize, 0);
      ctx.lineTo(x * blockSize, ROWS * blockSize);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * blockSize);
      ctx.lineTo(COLS * blockSize, y * blockSize);
      ctx.stroke();
    }

    // Draw board
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (boardRef.current[row][col]) {
          ctx.fillStyle = boardRef.current[row][col]!;
          ctx.fillRect(col * blockSize + 1, row * blockSize + 1, blockSize - 2, blockSize - 2);
        }
      }
    }

    // Draw current piece
    const piece = currentPieceRef.current;
    if (piece) {
      ctx.fillStyle = piece.color;
      for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
          if (piece.shape[row][col]) {
            ctx.fillRect(
              (piece.x + col) * blockSize + 1,
              (piece.y + row) * blockSize + 1,
              blockSize - 2,
              blockSize - 2
            );
          }
        }
      }
    }
  }, [blockSize]);

  const gameLoop = useCallback((timestamp: number) => {
    // Use refs to get current values, avoiding stale closures
    if (gameOverRef.current || isPausedRef.current) {
      // Still request next frame to check if unpaused
      if (!gameOverRef.current) {
        animationRef.current = requestAnimationFrame(gameLoop);
      }
      return;
    }

    const dropInterval = Math.max(100, 1000 - (levelRef.current - 1) * 100);

    if (timestamp - lastDropRef.current > dropInterval) {
      const piece = currentPieceRef.current;
      if (piece) {
        if (isValidMove(piece, 0, 1)) {
          piece.y++;
        } else {
          lockPiece(piece);
          playDrop();
          clearLines();
          const newPiece = createPiece();
          if (!isValidMove(newPiece, 0, 0)) {
            gameOverRef.current = true;
            setGameOver(true);
            playGameOver();
            stopMusic();
            return;
          }
          currentPieceRef.current = newPiece;
        }
      }
      lastDropRef.current = timestamp;
    }

    draw();
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [isValidMove, lockPiece, clearLines, createPiece, draw, playDrop, playGameOver, stopMusic]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Allow pause toggle even when paused
    if (e.key === 'p' || e.key === 'P') {
      if (!gameOver) {
        isPausedRef.current = !isPausedRef.current;
        setIsPaused(p => !p);
      }
      return;
    }
    
    if (gameOver || isPausedRef.current) return;
    
    const piece = currentPieceRef.current;
    if (!piece) return;

    switch (e.key) {
      case 'ArrowLeft':
        if (isValidMove(piece, -1, 0)) {
          piece.x--;
          playMove();
        }
        break;
      case 'ArrowRight':
        if (isValidMove(piece, 1, 0)) {
          piece.x++;
          playMove();
        }
        break;
      case 'ArrowDown':
        if (isValidMove(piece, 0, 1)) piece.y++;
        break;
      case 'ArrowUp':
        if (tryRotateWithWallKick(piece)) {
          playRotate();
        }
        break;
      case ' ':
        while (isValidMove(piece, 0, 1)) piece.y++;
        playDrop();
        break;
    }
    draw();
  }, [gameOver, isValidMove, tryRotateWithWallKick, draw, playMove, playRotate, playDrop]);

  const handleControl = useCallback((action: 'left' | 'right' | 'down' | 'rotate' | 'drop') => {
    if (gameOver || isPausedRef.current) return;
    
    const piece = currentPieceRef.current;
    if (!piece) return;

    switch (action) {
      case 'left':
        if (isValidMove(piece, -1, 0)) {
          piece.x--;
          playMove();
        }
        break;
      case 'right':
        if (isValidMove(piece, 1, 0)) {
          piece.x++;
          playMove();
        }
        break;
      case 'down':
        if (isValidMove(piece, 0, 1)) piece.y++;
        break;
      case 'rotate':
        if (tryRotateWithWallKick(piece)) {
          playRotate();
        }
        break;
      case 'drop':
        while (isValidMove(piece, 0, 1)) piece.y++;
        playDrop();
        break;
    }
    draw();
  }, [gameOver, isValidMove, tryRotateWithWallKick, draw, playMove, playRotate, playDrop]);

  // Touch gesture handlers for swipe controls
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (gameOver || isPausedRef.current) return;
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, [gameOver]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (gameOver || isPausedRef.current || !touchStartRef.current) return;
    
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    
    const piece = currentPieceRef.current;
    if (!piece) return;

    // Check for tap (rotate)
    if (absX < TAP_THRESHOLD && absY < TAP_THRESHOLD && deltaTime < TAP_TIME_THRESHOLD) {
      if (tryRotateWithWallKick(piece)) {
        playRotate();
        draw();
      }
    }
    // Check for horizontal swipe (move left/right)
    else if (absX > SWIPE_THRESHOLD && absX > absY) {
      if (deltaX > 0) {
        // Swipe right
        if (isValidMove(piece, 1, 0)) {
          piece.x++;
          playMove();
          draw();
        }
      } else {
        // Swipe left
        if (isValidMove(piece, -1, 0)) {
          piece.x--;
          playMove();
          draw();
        }
      }
    }
    // Check for downward swipe (hard drop)
    else if (deltaY > SWIPE_THRESHOLD && absY > absX) {
      while (isValidMove(piece, 0, 1)) piece.y++;
      playDrop();
      draw();
    }
    
    touchStartRef.current = null;
  }, [gameOver, isValidMove, tryRotateWithWallKick, draw, playMove, playRotate, playDrop]);

  const resetGame = useCallback(() => {
    boardRef.current = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    currentPieceRef.current = createPiece();
    scoreRef.current = 0;
    levelRef.current = 1;
    isPausedRef.current = false;
    gameOverRef.current = false;
    setScore(0);
    setLevel(1);
    setGameOver(false);
    setIsPaused(false);
    setIsNewHighScore(false);
    setShowNameEntry(false);
    setPlayerName(['A', 'A', 'A']);
    setActiveLetterIndex(0);
    lastDropRef.current = 0;
    startMusic();
    // Restart the game loop
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [createPiece, gameLoop, startMusic]);

  // Load high scores from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHighScores(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load high scores:', e);
    }
  }, []);

  // Check if score qualifies for leaderboard when game ends
  useEffect(() => {
    if (gameOver && score > 0) {
      // Check if this score qualifies for the leaderboard
      const lowestScore = highScores.length >= MAX_HIGH_SCORES 
        ? highScores[highScores.length - 1]?.score || 0 
        : 0;
      const qualifies = highScores.length < MAX_HIGH_SCORES || score > lowestScore;
      
      if (qualifies) {
        setIsNewHighScore(true);
        setShowNameEntry(true);
        setPlayerName(['A', 'A', 'A']);
        setActiveLetterIndex(0);
      }
    }
  }, [gameOver]);

  const submitHighScore = useCallback(() => {
    const newScore: HighScore = {
      name: playerName.join(''),
      score,
      level,
      date: new Date().toLocaleDateString(),
    };
    
    const updatedScores = [...highScores, newScore]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_HIGH_SCORES);
    
    setHighScores(updatedScores);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScores));
    setShowNameEntry(false);
  }, [playerName, score, level, highScores]);

  const cycleLetterUp = useCallback(() => {
    setPlayerName(prev => {
      const newName = [...prev];
      const currentChar = newName[activeLetterIndex].charCodeAt(0);
      newName[activeLetterIndex] = currentChar >= 90 ? 'A' : String.fromCharCode(currentChar + 1);
      return newName;
    });
  }, [activeLetterIndex]);

  const cycleLetterDown = useCallback(() => {
    setPlayerName(prev => {
      const newName = [...prev];
      const currentChar = newName[activeLetterIndex].charCodeAt(0);
      newName[activeLetterIndex] = currentChar <= 65 ? 'Z' : String.fromCharCode(currentChar - 1);
      return newName;
    });
  }, [activeLetterIndex]);

  useEffect(() => {
    currentPieceRef.current = createPiece();
    window.addEventListener('keydown', handleKeyDown);
    animationRef.current = requestAnimationFrame(gameLoop);
    startMusic();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationRef.current);
      stopMusic();
    };
  }, [createPiece, handleKeyDown, gameLoop, startMusic, stopMusic]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] flex flex-col items-center justify-start md:justify-center p-2 md:p-4 pt-14 md:pt-4">
      <div className="absolute top-2 left-2 md:top-4 md:left-4">
        <Link to="/">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-xs md:text-sm">
            <ArrowLeft className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
            Back
          </Button>
        </Link>
      </div>
      
      <div className="absolute top-2 right-2 md:top-4 md:right-4">
        <Button 
          variant="ghost" 
          size="sm"
          className="text-white hover:bg-white/10"
          onClick={toggleSound}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 md:w-5 md:h-5" /> : <VolumeX className="w-4 h-4 md:w-5 md:h-5" />}
        </Button>
      </div>

      <h1 className="text-xl md:text-3xl font-bold text-white mb-2 md:mb-4 tracking-wider">🎮 TETRIS</h1>
      
      {/* Score/Level - horizontal on mobile, vertical on desktop */}
      <div className="flex md:hidden gap-4 mb-2 text-white">
        <div className="bg-white/10 rounded-lg px-4 py-1 flex items-center gap-2">
          <span className="text-xs opacity-70">Score</span>
          <span className="text-lg font-bold">{score}</span>
        </div>
        <div className="bg-white/10 rounded-lg px-4 py-1 flex items-center gap-2">
          <span className="text-xs opacity-70">Level</span>
          <span className="text-lg font-bold">{level}</span>
        </div>
      </div>
      
      <div className="flex gap-4 md:gap-8 items-start">
        {/* Desktop score/level sidebar */}
        <div className="hidden md:flex flex-col gap-2 text-white">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm opacity-70">Score</div>
            <div className="text-2xl font-bold">{score}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-sm opacity-70">Level</div>
            <div className="text-2xl font-bold">{level}</div>
          </div>
        </div>

        <div className="relative">
          <canvas
            ref={canvasRef}
            width={COLS * blockSize}
            height={ROWS * blockSize}
            className="border-2 border-white/20 rounded-lg touch-none"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
          
          {gameOver && (
            <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center rounded-lg font-mono p-2">
              <div className="text-red-500 text-xl md:text-3xl font-bold mb-2 md:mb-4 animate-pulse tracking-widest">GAME OVER</div>
              <div className="text-cyan-400 text-base md:text-xl mb-4 md:mb-6">SCORE: {score.toLocaleString()}</div>
              
              {showNameEntry && isNewHighScore ? (
                <div className="flex flex-col items-center">
                  <div className="text-yellow-400 text-sm md:text-lg mb-2 md:mb-4 flex items-center gap-2 animate-pulse">
                    <Trophy className="w-4 h-4 md:w-5 md:h-5" />
                    NEW HIGH SCORE!
                  </div>
                  <div className="text-green-400 text-xs md:text-sm mb-2 md:mb-4">ENTER YOUR INITIALS</div>
                  
                  {/* Arcade-style letter selector */}
                  <div className="flex gap-2 md:gap-4 mb-4 md:mb-6">
                    {playerName.map((letter, index) => (
                      <div key={index} className="flex flex-col items-center">
                        <button
                          onClick={() => {
                            setActiveLetterIndex(index);
                            cycleLetterUp();
                          }}
                          className="text-white/50 hover:text-white text-lg md:text-2xl px-2"
                        >
                          ▲
                        </button>
                        <div
                          onClick={() => setActiveLetterIndex(index)}
                          className={`text-2xl md:text-4xl w-10 h-12 md:w-12 md:h-14 flex items-center justify-center border-2 cursor-pointer transition-all ${
                            activeLetterIndex === index
                              ? 'border-yellow-400 text-yellow-400 bg-yellow-400/10'
                              : 'border-cyan-400/50 text-cyan-400'
                          }`}
                        >
                          {letter}
                        </div>
                        <button
                          onClick={() => {
                            setActiveLetterIndex(index);
                            cycleLetterDown();
                          }}
                          className="text-white/50 hover:text-white text-lg md:text-2xl px-2"
                        >
                          ▼
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      onClick={submitHighScore}
                      className="bg-green-500 hover:bg-green-400 text-black font-bold tracking-wider"
                    >
                      SUBMIT
                    </Button>
                    <Button
                      onClick={() => {
                        setShowNameEntry(false);
                        setIsNewHighScore(false);
                      }}
                      variant="outline"
                      className="border-white/30 text-white hover:bg-white/10"
                    >
                      SKIP
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={resetGame} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold tracking-wider">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  PLAY AGAIN
                </Button>
              )}
            </div>
          )}
          
          {isPaused && !gameOver && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
              <div className="text-white text-2xl font-bold">PAUSED</div>
            </div>
          )}
        </div>

        {/* Desktop sidebar - controls and high scores */}
        <div className="hidden md:flex flex-col gap-2 text-white text-sm">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="font-bold mb-2">Controls</div>
            <div>← → Move</div>
            <div>↑ Rotate</div>
            <div>↓ Soft Drop</div>
            <div>Space Hard Drop</div>
            <div>P Pause</div>
          </div>
          
          {/* High Scores - Arcade Style */}
          <div className="bg-black/80 rounded-lg p-3 border border-yellow-400/30 font-mono">
            <div className="font-bold mb-3 flex items-center gap-2 text-yellow-400 tracking-wider">
              <Trophy className="w-4 h-4" />
              HIGH SCORES
            </div>
            {highScores.length === 0 ? (
              <div className="text-cyan-400/50 text-xs tracking-wide">NO SCORES YET</div>
            ) : (
              <div className="space-y-1">
                {highScores.map((hs, i) => (
                  <div key={i} className={`flex justify-between text-xs ${i === 0 ? 'text-yellow-400' : 'text-cyan-400'}`}>
                    <span className="tracking-wider">
                      {i + 1}. {hs.name || '???'}
                    </span>
                    <span>{hs.score.toLocaleString().padStart(6, ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Controls */}
      <div className="mt-3 grid grid-cols-3 gap-2 md:hidden w-full max-w-[250px]">
        <Button
          variant="outline"
          className="bg-white/10 border-white/20 text-white h-12 text-xl"
          onTouchStart={() => handleControl('left')}
        >
          ←
        </Button>
        <Button
          variant="outline"
          className="bg-white/10 border-white/20 text-white h-12 text-xl"
          onTouchStart={() => handleControl('rotate')}
        >
          ↻
        </Button>
        <Button
          variant="outline"
          className="bg-white/10 border-white/20 text-white h-12 text-xl"
          onTouchStart={() => handleControl('right')}
        >
          →
        </Button>
        <Button
          variant="outline"
          className="bg-white/10 border-white/20 text-white h-12 col-span-2"
          onTouchStart={() => handleControl('down')}
        >
          ↓ Down
        </Button>
        <Button
          variant="outline"
          className="bg-white/10 border-white/20 text-white h-12 text-xl"
          onTouchStart={() => handleControl('drop')}
        >
          ⬇
        </Button>
      </div>

      <p className="text-white/50 text-xs md:text-sm mt-3 md:mt-6">Pass the time while waiting for your Luas! 🚃</p>
    </div>
  );
};

export default Tetris;
