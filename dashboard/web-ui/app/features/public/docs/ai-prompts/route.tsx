import type { Route } from "./+types/route";
import {
  buildProjectAIPromptById,
  normalizeAIPromptId,
  projectFromAIPromptSearchParams,
} from "~/shared/constants/aiPrompts";

export async function loader({ params, request }: Route.LoaderArgs) {
  const promptId = normalizeAIPromptId(params.promptId);
  if (!promptId) {
    throw new Response("AI prompt not found", { status: 404 });
  }

  const url = new URL(request.url);
  const project = projectFromAIPromptSearchParams(url.searchParams);
  const prompt = buildProjectAIPromptById(promptId, project);

  return new Response(prompt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
