import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const forgeApiUrl = "https://forge.manus.ai";
const forgeApiKey = "eYNjsiF9ktCdUtHChPEMsj";
const appId = "jXb8CWGPzwHDiFUp7FkPz8";

const s3Client = new S3Client({
  region: "auto",
  endpoint: `${forgeApiUrl}/storage`,
  credentials: {
    accessKeyId: "manus",
    secretAccessKey: forgeApiKey,
  },
  forcePathStyle: true,
});

const bucketName = `app-${appId}`;

async function testUpload() {
  try {
    console.log(`[Test] Uploading to bucket: ${bucketName}`);
    console.log(`[Test] Endpoint: ${forgeApiUrl}/storage`);
    
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: "test/hello.txt",
        Body: Buffer.from("Hello World!"),
        ContentType: "text/plain",
      })
    );
    
    const url = `${forgeApiUrl}/storage/${bucketName}/test/hello.txt`;
    console.log(`[Test] ✓ Upload successful: ${url}`);
  } catch (error) {
    console.error("[Test] ✗ Upload failed:", error.message);
    console.error("[Test] Error details:", error);
  }
}

testUpload();
