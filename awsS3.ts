import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({ region: "asia-northeast-1" });

async function createUploadUrl(bucket: string, key: string) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    // Optional: Force a specific content type
    ContentType: "image/jpeg",
  });

  // expires in 1 hour (3600 seconds)
  return await getSignedUrl(client, command, { expiresIn: 3600 });
}

async function createDownloadUrl(bucket: string, key: string) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  // The URL will stop working exactly 3600 seconds after generation
  return await getSignedUrl(client, command, { expiresIn: 3600 });
}
