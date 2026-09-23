import { BrandSymbol } from "@/components/Brand";

export default function NotFound() {
  return (
    <main className="access">
      <div className="access-card" style={{ textAlign: "center", justifyItems: "center" }}>
        <BrandSymbol size={56} />
        <h1 className="access-title">Page not found</h1>
        <p className="access-sub">This address doesn&rsquo;t exist in the media space.</p>
        <a href="/" className="btn">Go to your media</a>
      </div>
    </main>
  );
}
