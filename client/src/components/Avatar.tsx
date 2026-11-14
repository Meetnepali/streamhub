export function Avatar({ name, src, size = 34 }: { name: string; src?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src ? <img src={src} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
