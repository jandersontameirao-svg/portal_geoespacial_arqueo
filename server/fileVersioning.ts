export type InitialFileVersionInput = {
  fileId: number;
  s3Key: string;
  s3Url: string;
  fileSize: number;
  mimeType: string | null;
  sha256: string;
  uploadedBy: number;
  originalName: string;
  fileType: string;
  source: "upload" | "raster-ingestion";
};

/**
 * A versão 1 aponta para os mesmos bytes recém-gravados no storage; ela não
 * duplica nem renomeia o objeto. As próximas versões devem usar chave própria.
 */
export function buildInitialFileVersion(input: InitialFileVersionInput) {
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("SHA-256 inválido para a versão do arquivo");
  if (input.fileId <= 0 || input.fileSize < 0 || !input.s3Key || !input.s3Url) throw new Error("Dados incompletos para versionar arquivo");
  return {
    fileId: input.fileId,
    version: 1,
    s3Key: input.s3Key,
    s3Url: input.s3Url,
    fileSize: input.fileSize,
    sha256: input.sha256.toLowerCase(),
    mimeType: input.mimeType,
    metadata: {
      kind: "initial-upload",
      originalName: input.originalName,
      fileType: input.fileType,
      source: input.source,
      immutableReference: true,
    },
    uploadedBy: input.uploadedBy,
    changeDescription: "Versão inicial criada no upload; referência imutável aos bytes verificados.",
  };
}
