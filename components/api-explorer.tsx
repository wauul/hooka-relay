"use client";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });
export function ApiExplorer() {
  return <section id="api-reference" className="api-explorer">
    <h2>Interactive API reference</h2>
    <p>Use a test application key. Try it out sends real requests to this deployment; mutations change that application. Keys stay in this page’s memory and are cleared on reload.</p>
    <SwaggerUI url="/openapi.json" validatorUrl={null} persistAuthorization={false} docExpansion="none" defaultModelsExpandDepth={-1} />
  </section>;
}
