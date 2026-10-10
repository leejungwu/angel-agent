"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const BUCKET = "product-assets";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function storageFileName(file: File): string {
  // Storage object keys use a safe filename; retain the exact original in file_name.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
  return `${crypto.randomUUID()}-${safeName || "image"}`;
}

export default function UploadProductAssets({ productId }: { productId: string | number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  // Reuse an uploaded object if metadata insertion fails and the user retries.
  const uploadedPaths = useRef(new Map<File, string>());
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function uploadImages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !files.length) return;
    const invalid = files.find((file) => !IMAGE_TYPES.includes(file.type) || file.size === 0);
    if (invalid) {
      setErrorMessage(`${invalid.name}: 비어 있지 않은 JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.`);
      return;
    }
    inFlight.current = true;
    setUploading(true);
    setErrorMessage("");
    setSuccessMessage("");
    let completed = 0;
    let currentFile: File | undefined;
    try {
      // Refresh the maximum at upload time instead of trusting page-rendered data.
      const { data: lastAsset, error: lookupError } = await supabase
        .from("product_assets")
        .select("id, sort_order")
        .eq("product_id", productId)
        .order("sort_order", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
        .returns<{ id: string | number; sort_order: number }>();
      if (lookupError) throw new Error(`기존 이미지 조회 실패: ${lookupError.message}`);
      const firstSortOrder = lastAsset ? lastAsset.sort_order + 1 : 0;

      for (const file of files) {
        currentFile = file;
        setProgress(`${completed + 1}/${files.length} 업로드 중...`);
        let path = uploadedPaths.current.get(file);
        if (!path) {
          path = `products/${productId}/${storageFileName(file)}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
            contentType: file.type,
            upsert: false,
          });
          if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
          uploadedPaths.current.set(file, path);
        }
        const { error: insertError } = await supabase.from("product_assets").insert({
          product_id: productId,
          asset_type: "image",
          storage_path: path,
          file_name: file.name,
          alt_text: null,
          sort_order: firstSortOrder + completed,
          is_primary: !lastAsset && completed === 0,
        });
        if (insertError) {
          throw new Error(`이미지 정보 저장 실패: ${insertError.message} (Storage 경로: ${path})`);
        }
        uploadedPaths.current.delete(file);
        completed++;
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setFiles(files.slice(completed));
      setErrorMessage(`${currentFile ? `${currentFile.name}: ` : ""}${
        error instanceof Error ? error.message : "이미지 업로드 중 오류가 발생했습니다."
      }`);
    } finally {
      if (completed > 0) setSuccessMessage(`${completed}장의 이미지를 저장했습니다.`);
      setProgress("");
      inFlight.current = false;
      setUploading(false);
      router.refresh();
    }
  }

  return (
    <form onSubmit={uploadImages} className="mt-4 rounded-lg border p-4" aria-busy={uploading}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={IMAGE_TYPES.join(",")}
        aria-label="사진 선택"
        disabled={uploading}
        className="hidden"
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []));
          setErrorMessage("");
          setSuccessMessage("");
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
        className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">
        사진 업로드
      </button>
      <p className="mt-2 text-sm text-zinc-500">JPEG, PNG, WebP · 여러 장 선택 가능</p>
      {files.length > 0 && (
        <ol className="mt-3 list-inside list-decimal text-sm text-zinc-500">
          {files.map((file, index) => <li key={index} className="break-words">{file.name}</li>)}
        </ol>
      )}
      <button
        type="submit"
        disabled={uploading || !files.length}
        className="mt-3 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {uploading ? progress || "업로드 중..." : "저장"}
      </button>
      {errorMessage && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm text-red-600">{errorMessage}</p>}
      {successMessage && <p role="status" className="mt-3 text-sm text-green-700">{successMessage}</p>}
    </form>
  );
}
