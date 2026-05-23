export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  timestamp: number;
  images?: string[];          // base64 images attached by the user (vision models)
  attachmentNames?: string[]; // just filenames, for display in the bubble
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

// Attachment held in UI state before it is sent
export interface PendingAttachment {
  id: string;
  filename: string;
  type: 'document' | 'image';
  text?: string;     // extracted text for documents
  base64?: string;   // raw base64 for images (no data: prefix)
  mimeType?: string;
}
