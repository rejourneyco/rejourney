/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables from wrangler.jsonc
const SUPABASE_URL = SUPABASE_URL || '';
const SUPABASE_KEY = SUPABASE_KEY || '';

export default {
  async fetch(request, env, ctx) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle OPTIONS request for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // Route handler
    const url = new URL(request.url);
    const path = url.pathname;

    // Upload endpoint for profile pictures
    if (path === '/api/upload-profile-picture') {
      return handleProfilePictureUpload(request, env, corsHeaders);
    }
    
    // Upload endpoint for post images
    else if (path === '/api/upload-post-image') {
      return handlePostImageUpload(request, env, corsHeaders);
    }
    
    // Public read access to images
    else if (path.startsWith('/images/')) {
      return handleImageGet(request, env, path, corsHeaders);
    }

    // Default response for unmatched routes
    return new Response('Not found', { 
      status: 404,
      headers: corsHeaders
    });
  }
};

// Handle profile picture uploads
async function handleProfilePictureUpload(request, env, corsHeaders) {
  // Verify authentication
  const userId = await verifyAuth(request, env); // Pass env here
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Process the uploaded file from FormData
    const formData = await request.formData();
    const file = formData.get('image');
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create a unique file path for the user's profile picture
    const fileExtension = getFileExtension(file.name);
    const filePath = `profiles/${userId}/profile${fileExtension}`;
    
    // Upload to R2
    await env.R2_BUCKET.put(filePath, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Return the public URL for the uploaded file
// Make sure to use the full URL including protocol and domain
const workerDomain = new URL(request.url).origin;
const publicUrl = `${workerDomain}/images/${filePath}`;
    return new Response(JSON.stringify({ 
      success: true,
      url: publicUrl
    }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle post image uploads
async function handlePostImageUpload(request, env, corsHeaders) {
  // Verify authentication
  const userId = await verifyAuth(request, env); // Pass env here  if (!userId) {
if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Process the uploaded file and any additional metadata
    const formData = await request.formData();
    const file = formData.get('image');
    const postId = formData.get('postId') || crypto.randomUUID();
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create a unique file path for the post image
    const fileExtension = getFileExtension(file.name);
    const timestamp = Date.now();
    const filePath = `posts/${userId}/${postId}_${timestamp}${fileExtension}`;
    
    // Upload to R2
    await env.R2_BUCKET.put(filePath, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Return the public URL and post ID
	const workerDomain = new URL(request.url).origin;
	const publicUrl = `${workerDomain}/images/${filePath}`;
	    return new Response(JSON.stringify({ 
      success: true,
      url: publicUrl,
      postId: postId
    }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle public image retrieval
async function handleImageGet(request, env, path, corsHeaders) {
  try {
    // Extract the file path from the URL
    const filePath = path.replace('/images/', '');
    
    // Get the file from R2
    const object = await env.R2_BUCKET.get(filePath);
    
    if (!object) {
      return new Response('Image not found', { 
        status: 404,
        headers: corsHeaders
      });
    }

    // Return the file with appropriate content type
    const headers = new Headers(corsHeaders);
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    
    return new Response(object.body, {
      headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Verify Supabase JWT token and return userId if valid
async function verifyAuth(request, env) {
	const authHeader = request.headers.get('Authorization') || '';
	const token = authHeader.replace('Bearer ', '');
	if (!token) {
	  return null;
	}
  
	try {

		if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
			throw new Error('Supabase credentials not configured');
		  }
	  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
	  const { data, error } = await supabase.auth.getUser(token);
	  
	  if (error || !data.user) {
		console.error('Error verifying user:', error);
		return null;
	  }
	  
	  return data.user.id;
	} catch (error) {
	  console.error('Auth verification error:', error);
	  return null;
	}
  }

// Helper function to get file extension
function getFileExtension(filename) {
  return filename.substring(filename.lastIndexOf('.'));
}