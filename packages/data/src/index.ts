import charactersJson from "./characters.demo.json";
import worksJson from "./works.demo.json";
import { charactersSchema, worksSchema } from "./schema";

export const demoCharacters = charactersSchema.parse(charactersJson);
export const demoWorks = worksSchema.parse(worksJson);

export * from "./schema";
