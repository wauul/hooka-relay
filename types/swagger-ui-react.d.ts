declare module "swagger-ui-react" {
  import type { ComponentType } from "react";
  const SwaggerUI: ComponentType<{ url: string; validatorUrl: null; persistAuthorization: boolean; docExpansion: "none"; defaultModelsExpandDepth: number }>;
  export default SwaggerUI;
}
