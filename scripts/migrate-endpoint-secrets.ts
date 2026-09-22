import "dotenv/config";
import { db } from "../lib/db";
import { migrateEndpointSecrets } from "../lib/migrate-endpoint-secrets";
migrateEndpointSecrets(db).then(result => console.log(result)).finally(() => db.$disconnect());
