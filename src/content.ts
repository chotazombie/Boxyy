// ContentLoader: deterministic mock content per (x,y) coordinate.
export type BoxContent =
  | { kind: 'video'; src: string }
  | { kind: 'image'; src: string }
  | { kind: 'iframe'; src: string }
  | { kind: 'html'; html: string }
  | { kind: 'livestream'; src: string }
  | { kind: 'text'; text: string };

const VIDEOS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
];

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return Math.abs(h ^ (h >>> 16));
}

export function getContent(x: number, y: number): BoxContent {
  const h = hash(x, y);
  const kind = h % 5;
  switch (kind) {
    case 0:
      return { kind: 'video', src: VIDEOS[h % VIDEOS.length] };
    case 1:
      return { kind: 'image', src: `https://picsum.photos/seed/${x}_${y}/800/800` };
    case 2:
      return {
        kind: 'html',
        html: `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:5vmin;background:linear-gradient(135deg,hsl(${h % 360},70%,30%),hsl(${(h + 120) % 360},70%,15%))">(${x}, ${y})</div>`,
      };
    case 3:
      return { kind: 'text', text: `Box (${x}, ${y})` };
    default:
      return { kind: 'iframe', src: `https://picsum.photos/seed/iframe_${x}_${y}/800/800` };
  }
}
