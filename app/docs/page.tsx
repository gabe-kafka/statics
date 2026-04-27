import Script from "next/script";

export const metadata = {
  title: "statics — API docs",
  description: "Interactive API reference for the statics structural-analysis endpoint.",
};

export default function DocsPage() {
  return (
    <div className="flex-1">
      <script
        id="api-reference"
        data-url="/api/v1/openapi.json"
        type="application/json"
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
        strategy="afterInteractive"
      />
    </div>
  );
}
