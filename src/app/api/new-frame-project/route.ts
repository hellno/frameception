import { NextResponse, NextRequest } from "next/server";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CREATE_NEW_PROJECT_ENDPOINT = 'https://herocast--create-frame-project-webhook.modal.run';

export const config = {
  maxDuration: 60,
};

export async function POST(req: NextRequest) {
  try {
    // Get request body
    const body = await req.json();
    const { prompt, description, userContext } = body;

    // Validate required fields
    if (!prompt || !description || !userContext) {
      return NextResponse.json(
        { error: "Project name, description and userContext are required" },
        { status: 400 }
      );
    }

    // Forward request to Modal backend
    const response = await fetch(CREATE_NEW_PROJECT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        description,
        userContext
      })
    });

    // Get response data
    const data = await response.json();

    // Forward the status code from the backend
    return NextResponse.json(data, { status: response.status });

  } catch (error) {
    console.error('Error proxying request to backend:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An unknown error occurred' },
      { status: 500 }
    );
  }
}
