import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const port = Number(process.env.API_PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`TouhouFlandre API listening on http://localhost:${port}`);
});
