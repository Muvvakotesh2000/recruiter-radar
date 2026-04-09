import { NextResponse } from "next/server";
import dns from "dns/promises";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ result: "invalid_format" });
  }

  const domain = email.split("@")[1];

  try {
    const records = await dns.resolveMx(domain);
    const hasMx = records && records.length > 0;
    return NextResponse.json({ result: hasMx ? "domain_ok" : "no_mx" });
  } catch {
    // ENOTFOUND / ENODATA = domain doesn't exist or has no MX records
    return NextResponse.json({ result: "no_mx" });
  }
}
