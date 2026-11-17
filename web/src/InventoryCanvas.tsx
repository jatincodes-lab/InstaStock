import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./inventory-canvas.css";

type Point = [number, number];

function polygon(context: CanvasRenderingContext2D, points: Point[], fill: string, stroke = "#b5ccd3") {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.stroke();
}

function parcel(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const height = size * 1.1;
  polygon(context, [[x, y], [x + size, y + size / 2], [x, y + size], [x - size, y + size / 2]], "#f5dfb6", "#ccb994");
  polygon(context, [[x - size, y + size / 2], [x, y + size], [x, y + size + height], [x - size, y + size / 2 + height]], "#ddc399", "#ccb994");
  polygon(context, [[x, y + size], [x + size, y + size / 2], [x + size, y + size / 2 + height], [x, y + size + height]], "#f0d6ab", "#ccb994");
  context.strokeStyle = "#fff3d9";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x - size / 2, y + size / 4);
  context.lineTo(x + size / 2, y + size * .75);
  context.lineTo(x + size / 2, y + size * 1.5);
  context.stroke();
}

function building(context: CanvasRenderingContext2D, x: number, y: number, branch: boolean) {
  polygon(context, [[x, y + 12], [x + 110, y + 65], [x, y + 118], [x - 110, y + 65]], "#e1f0ec", "#cfe2df");
  polygon(context, [[x - 77, y - 12], [x, y + 22], [x, y + 95], [x - 77, y + 59]], "#d3e3ed");
  polygon(context, [[x, y + 22], [x + 77, y - 12], [x + 77, y + 59], [x, y + 95]], "#f6fbfd");
  polygon(context, [[x, y - 48], [x + 84, y - 12], [x, y + 26], [x - 84, y - 12]], branch ? "#b8dace" : "#a9c9eb", branch ? "#9fc5b8" : "#92b8df");
  for (let i = 1; i < 5; i++) {
    context.strokeStyle = branch ? "#a6cdbf" : "#94b9df";
    context.beginPath();
    context.moveTo(x - 84 + i * 17, y - 12 + i * 7.6);
    context.lineTo(x + i * 17, y - 48 + i * 7.2);
    context.stroke();
  }
  polygon(context, [[x + 18, y + 27], [x + 57, y + 10], [x + 57, y + 66], [x + 18, y + 84]], "#91afb9");
  for (let i = 0; i < 5; i++) {
    context.strokeStyle = "#b8cdd3";
    context.beginPath();
    context.moveTo(x + 20, y + 35 + i * 9);
    context.lineTo(x + 55, y + 20 + i * 9);
    context.stroke();
  }
  polygon(context, [[x - 60, y + 14], [x - 25, y + 30], [x - 25, y + 45], [x - 60, y + 29]], "#ecf6fc", "#b8cedb");
  parcel(context, x - 62, y + 62, 12);
  parcel(context, x - 38, y + 76, 10);
}

function draw(context: CanvasRenderingContext2D, time: number) {
  context.clearRect(0, 0, 760, 350);
  for (let x = 25; x < 760; x += 22) for (let y = 18; y < 350; y += 22) {
    context.fillStyle = "#bdcfd52e";
    context.fillRect(x, y, 1.5, 1.5);
  }
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(210, 170);
  context.bezierCurveTo(315, 280, 445, 280, 550, 170);
  context.lineWidth = 32;
  context.strokeStyle = "#dceae8";
  context.stroke();
  context.lineWidth = 24;
  context.strokeStyle = "#f1f8f4";
  context.stroke();
  context.lineWidth = 1;
  context.setLineDash([3, 9]);
  context.lineDashOffset = -time * 10;
  context.strokeStyle = "#9db9af";
  context.stroke();
  context.setLineDash([]);
  building(context, 155, 110, false);
  building(context, 605, 110, true);

  for (let index = 0; index < 4; index++) {
    const progress = (time / 13 + index / 4) % 1;
    const inverse = 1 - progress;
    const x = inverse ** 3 * 210 + 3 * inverse ** 2 * progress * 315 + 3 * inverse * progress ** 2 * 445 + progress ** 3 * 550;
    const y = inverse ** 3 * 170 + 3 * inverse ** 2 * progress * 280 + 3 * inverse * progress ** 2 * 280 + progress ** 3 * 170;
    context.save();
    context.globalAlpha = Math.min(1, progress * 12, (1 - progress) * 12);
    context.fillStyle = "#53736b16";
    context.beginPath();
    context.ellipse(x, y + 6, 17, 7, 0, 0, Math.PI * 2);
    context.fill();
    parcel(context, x, y - 25, 12);
    context.restore();
  }

  context.strokeStyle = "#7aafa0";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(361, 257);
  context.lineTo(361, 211);
  context.quadraticCurveTo(361, 203, 369, 203);
  context.lineTo(397, 203);
  context.quadraticCurveTo(405, 203, 405, 211);
  context.lineTo(405, 257);
  context.stroke();
  context.fillStyle = `rgba(102, 176, 149, ${.12 + .08 * Math.sin(time * 2)})`;
  context.fillRect(366, 207, 34, 43);
  context.fillStyle = "#5b9e82";
  context.beginPath();
  context.arc(383, 202, 3, 0, Math.PI * 2);
  context.fill();

  context.textAlign = "center";
  context.font = '500 12px "Inter Variable", sans-serif';
  context.fillStyle = "#597b7b";
  context.fillText("Warehouse", 155, 278);
  context.fillText("Branch", 605, 278);
  context.font = '400 10px "Inter Variable", sans-serif';
  context.fillStyle = "#72918b";
  context.fillText("STOCK IN MOTION", 383, 300);
}

export default function InventoryCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let time = elapsedRef.current;
    let previous = 0;
    let visible = true;
    let width = 0;
    let height = 0;

    function paint() {
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      context!.clearRect(0, 0, width, height);
      const scale = Math.min(width / 760, height / 350);
      context!.translate((width - 760 * scale) / 2, (height - 350 * scale) / 2);
      context!.scale(scale, scale);
      draw(context!, time);
    }
    function tick(now: number) {
      if (now - previous >= 1000 / 30) {
        time += previous ? Math.min((now - previous) / 1000, .1) : 0;
        elapsedRef.current = time;
        previous = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      previous = 0;
      paint();
      if (!paused && !motion.matches && visible && !document.hidden && width && height) frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      sync();
    });
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    resize.observe(canvas);
    intersection.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, [paused]);

  return <div className="inventory-canvas-scene">
    <canvas ref={canvasRef} className="inventory-canvas" aria-hidden="true" />
    <button type="button" className="canvas-motion-control" onClick={() => setPaused(!paused)} aria-label={paused ? "Play inventory animation" : "Pause inventory animation"} aria-pressed={paused}>
      {paused ? <Play size={13} /> : <Pause size={13} />}<span>{paused ? "Play animation" : "Pause animation"}</span>
    </button>
  </div>;
}
