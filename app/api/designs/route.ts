import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const designs = await prisma.design.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json(designs);
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    id?: string;
    name: string;
    nodes?: string;
    members?: string;
    loadCases?: string;
    loadCombinations?: string;
    pointLoads?: string;
    axialLoads?: string;
    pointMoments?: string;
    distLoads?: string;
    fixity?: string;
    pointSprings?: string;
    uniformSprings?: string;
    hinges?: string;
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const data = {
    name: body.name.trim(),
    nodes: body.nodes ?? "",
    members: body.members ?? "",
    loadCases: body.loadCases ?? "",
    loadCombinations: body.loadCombinations ?? "",
    pointLoads: body.pointLoads ?? "",
    axialLoads: body.axialLoads ?? "",
    pointMoments: body.pointMoments ?? "",
    distLoads: body.distLoads ?? "",
    fixity: body.fixity ?? "",
    pointSprings: body.pointSprings ?? "",
    uniformSprings: body.uniformSprings ?? "",
    hinges: body.hinges ?? "",
  };

  if (body.id) {
    const existing = await prisma.design.findUnique({ where: { id: body.id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const design = await prisma.design.update({
      where: { id: body.id },
      data,
    });
    return NextResponse.json(design);
  }

  const design = await prisma.design.create({
    data: { ...data, userId },
  });
  return NextResponse.json(design);
}
