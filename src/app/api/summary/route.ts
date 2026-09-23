import { handle, json, requireAccess } from "@/server/http";
import { summary } from "@/server/media";

export const GET = handle(async (req) => {
  await requireAccess(req);
  return json(summary());
});
