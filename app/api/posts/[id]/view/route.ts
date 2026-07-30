import { accountRouteError, requireEmptyAccountMutation, requireEmptyAccountQuery } from "@/lib/account/http";
import { recordPostView } from "@/lib/account/repository";
import { enforceSameOrigin, requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;
  const session = await requireUser(request);
  if (!session.ok) return session.response;

  try {
    requireEmptyAccountQuery(request);
    await requireEmptyAccountMutation(request);
    await recordPostView(session.user.id, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return accountRouteError(error);
  }
}
