import { fail, handle, json, readJson, requireAccess } from "@/server/http";
import { prepareArchive } from "@/server/archive";

export const runtime = "nodejs";

/** Step 1 of a bulk download: validate the selection and return a short-lived token. */
export const POST = handle(async (req) => {
  await requireAccess(req);
  const { ids } = await readJson<{ ids?: unknown }>(req);
  const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [];
  if (!list.length) return fail(400, "Select at least one file.");
  return json(await prepareArchive(list));
});
