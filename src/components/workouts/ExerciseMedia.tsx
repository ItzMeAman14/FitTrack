import { type ChangeEvent, useState } from 'react';
import { Dumbbell, Film, ImageIcon, Play, Trash2, Upload } from 'lucide-react';
import type { MuscleGroup } from '../../types/fittrack';
import { parseVideoSource } from '../../utils/media';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface ExerciseMediaThumbnailProps {
  name: string;
  muscleGroup: MuscleGroup;
  imageUrl?: string | null;
  videoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export function ExerciseMediaThumbnail({
  name,
  muscleGroup,
  imageUrl,
  videoUrl,
  size = 'md',
  onClick,
}: ExerciseMediaThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const parsedVideo = parseVideoSource(videoUrl);

  const dims =
    size === 'sm'
      ? 'h-12 w-16 rounded-[8px]'
      : size === 'lg'
        ? 'h-40 w-full rounded-[10px]'
        : 'h-16 w-24 rounded-[9px]';

  const hasValidImage = Boolean(imageUrl && !imgError);
  const youtubeThumb =
    !hasValidImage && parsedVideo?.kind === 'youtube' ? parsedVideo.thumbnailUrl : null;
  const displayThumb = hasValidImage ? imageUrl! : youtubeThumb;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`relative shrink-0 overflow-hidden border border-[#252D38] bg-[#0D121A] flex items-center justify-center group ${dims} ${
        onClick ? 'cursor-pointer hover:border-[#B6F36A]/60 transition-colors' : ''
      }`}
      aria-label={onClick ? `View media for ${name}` : undefined}
    >
      {displayThumb ? (
        <img
          src={displayThumb}
          alt={`${name} demonstration`}
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : parsedVideo?.kind === 'video' ? (
        <video
          src={parsedVideo.src}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover pointer-events-none"
        />
      ) : parsedVideo?.kind === 'vimeo' ? (
        <div className="flex flex-col items-center justify-center text-[#62A8F7] gap-1 px-2 text-center">
          <Film className="h-5 w-5" />
          {size !== 'sm' && <span className="text-[10px] font-medium">Video Ready</span>}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center text-[#626C7B] gap-1 px-1.5 text-center">
          <Dumbbell className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
          {size === 'lg' && (
            <span className="text-[11px] font-medium text-[#626C7B]">
              No demonstration media · {muscleGroup}
            </span>
          )}
        </div>
      )}

      {parsedVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/45 transition-colors">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#B6F36A] text-[#090B0F] shadow">
            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
          </span>
        </span>
      )}
    </Wrapper>
  );
}

export interface ExerciseDetailItem {
  name: string;
  muscleGroup: MuscleGroup;
  equipment?: string;
  sets?: number;
  reps?: string;
  restSeconds?: number;
  targetWeightKg?: number | null;
  instructions?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}

interface ExerciseMediaModalProps {
  open: boolean;
  onClose: () => void;
  exercise: ExerciseDetailItem | null;
  weightUnitLabel?: string;
  displayWeight?: number | null;
  onEditMedia?: () => void;
}

export function ExerciseMediaModal({
  open,
  onClose,
  exercise,
  weightUnitLabel = 'kg',
  displayWeight,
  onEditMedia,
}: ExerciseMediaModalProps) {
  const [tab, setTab] = useState<'video' | 'image'>('video');

  if (!exercise) return null;
  const parsedVideo = parseVideoSource(exercise.videoUrl);
  const hasVideo = Boolean(parsedVideo);
  const hasImage = Boolean(exercise.imageUrl);
  const activeTab = tab === 'video' && hasVideo ? 'video' : hasImage ? 'image' : hasVideo ? 'video' : 'none';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={exercise.name}
      subtitle={`${exercise.muscleGroup}${exercise.equipment ? ` · ${exercise.equipment}` : ''}`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4">
        {hasVideo && hasImage && (
          <div className="flex items-center gap-1 p-1 rounded-[9px] bg-[#0D121A] border border-[#252D38] w-fit">
            <button
              type="button"
              onClick={() => setTab('video')}
              className={`px-3 py-1 text-xs font-medium rounded-[6px] cursor-pointer ${
                activeTab === 'video' ? 'bg-[#26351D] text-[#B6F36A]' : 'text-[#929BAA]'
              }`}
            >
              Demonstration Video
            </button>
            <button
              type="button"
              onClick={() => setTab('image')}
              className={`px-3 py-1 text-xs font-medium rounded-[6px] cursor-pointer ${
                activeTab === 'image' ? 'bg-[#26351D] text-[#B6F36A]' : 'text-[#929BAA]'
              }`}
            >
              Demonstration Image
            </button>
          </div>
        )}

        {activeTab === 'video' && parsedVideo && (
          <div className="aspect-video w-full overflow-hidden rounded-[12px] border border-[#252D38] bg-[#090B0F]">
            {parsedVideo.kind === 'youtube' || parsedVideo.kind === 'vimeo' ? (
              <iframe
                src={parsedVideo.embedUrl}
                title={`${exercise.name} demonstration video`}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                src={parsedVideo.src}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain bg-black"
              />
            )}
          </div>
        )}

        {activeTab === 'image' && exercise.imageUrl && (
          <div className="overflow-hidden rounded-[12px] border border-[#252D38] bg-[#090B0F] flex items-center justify-center max-h-[360px]">
            <img
              src={exercise.imageUrl}
              alt={`${exercise.name} demonstration`}
              className="max-h-[360px] w-auto object-contain"
            />
          </div>
        )}

        {activeTab === 'none' && (
          <div className="h-44 rounded-[12px] border border-dashed border-[#252D38] bg-[#0D121A] flex flex-col items-center justify-center gap-2 text-center px-4">
            <Dumbbell className="h-7 w-7 text-[#626C7B]" />
            <p className="text-sm font-medium text-[#929BAA]">No demonstration media attached</p>
            <p className="text-xs text-[#626C7B]">
              Add an exercise image or video URL/upload to display visual cues here.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3">
          <div>
            <div className="text-[11px] text-[#626C7B]">Sets</div>
            <div className="font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
              {exercise.sets ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#626C7B]">Reps</div>
            <div className="font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
              {exercise.reps || '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#626C7B]">Rest Time</div>
            <div className="font-mono text-sm font-semibold text-[#F5F7FA] tabular-nums">
              {exercise.restSeconds ? `${exercise.restSeconds}s` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#626C7B]">Target Weight</div>
            <div className="font-mono text-sm font-semibold text-[#B6F36A] tabular-nums">
              {displayWeight !== null && displayWeight !== undefined
                ? `${displayWeight} ${weightUnitLabel}`
                : exercise.targetWeightKg !== null && exercise.targetWeightKg !== undefined
                  ? `${exercise.targetWeightKg} ${weightUnitLabel}`
                  : 'Bodyweight / Open'}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium text-[#929BAA]">Form Cues & Instructions</div>
          <p className="text-sm leading-relaxed text-[#F5F7FA] bg-[#0D121A] border border-[#202733] rounded-[10px] p-3">
            {exercise.instructions?.trim() || 'No instructions recorded for this exercise.'}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {onEditMedia && (
            <Button variant="secondary" size="sm" onClick={onEditMedia}>
              Edit Media & Details
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ExerciseMediaFieldsProps {
  imageUrl: string;
  videoUrl: string;
  onImageChange: (next: string) => void;
  onVideoChange: (next: string) => void;
  onError: (msg: string) => void;
}

export function ExerciseMediaFields({
  imageUrl,
  videoUrl,
  onImageChange,
  onVideoChange,
  onError,
}: ExerciseMediaFieldsProps) {
  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('Please choose a valid image file (PNG, JPG, WebP, GIF).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      onError('Image must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImageChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleVideoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      onError('Please choose a valid video file (MP4, WebM, MOV, OGG).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onError('Uploaded video must be 8 MB or smaller. For longer videos, paste a YouTube or video URL.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onVideoChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const isUploadedImage = imageUrl.startsWith('data:image/');
  const isUploadedVideo = videoUrl.startsWith('data:video/');
  const parsedVideo = parseVideoSource(videoUrl);

  return (
    <div className="space-y-4 rounded-[10px] border border-[#202733] bg-[#0D121A] p-3.5">
      <div className="text-xs font-semibold text-[#F5F7FA]">Demonstration Media</div>

      {/* Image Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-[#929BAA] flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-[#B6F36A]" />
            Demonstration Image
          </label>
          {imageUrl && (
            <button
              type="button"
              onClick={() => onImageChange('')}
              className="inline-flex items-center gap-1 text-[11px] text-[#F16C75] hover:underline cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Remove Image
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="https://... image URL or upload file"
            value={isUploadedImage ? '' : imageUrl}
            onChange={(e) => onImageChange(e.target.value)}
          />
          <label className="inline-flex items-center justify-center gap-1.5 shrink-0 h-10 px-3 rounded-[9px] border border-[#252D38] bg-[#121720] text-xs font-medium text-[#F5F7FA] hover:border-[#B6F36A] cursor-pointer">
            <Upload className="h-3.5 w-3.5 text-[#B6F36A]" />
            {imageUrl ? 'Replace Image' : 'Upload Image'}
            <input type="file" accept="image/*" onChange={handleImageFile} className="hidden" />
          </label>
        </div>
        {imageUrl && (
          <div className="flex items-center gap-3 pt-1">
            <img
              src={imageUrl}
              alt="Exercise preview"
              className="h-14 w-20 rounded-[8px] object-cover border border-[#252D38]"
            />
            <span className="text-[11px] text-[#929BAA]">
              {isUploadedImage ? 'Uploaded image file attached' : 'External image URL linked'}
            </span>
          </div>
        )}
      </div>

      {/* Video Section */}
      <div className="space-y-2 pt-2 border-t border-[#202733]">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-[#929BAA] flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5 text-[#62A8F7]" />
            Demonstration Video (URL or Upload max 8 MB)
          </label>
          {videoUrl && (
            <button
              type="button"
              onClick={() => onVideoChange('')}
              className="inline-flex items-center gap-1 text-[11px] text-[#F16C75] hover:underline cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Remove Video
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="YouTube, Vimeo, or direct .mp4 URL"
            value={isUploadedVideo ? '' : videoUrl}
            onChange={(e) => onVideoChange(e.target.value)}
          />
          <label className="inline-flex items-center justify-center gap-1.5 shrink-0 h-10 px-3 rounded-[9px] border border-[#252D38] bg-[#121720] text-xs font-medium text-[#F5F7FA] hover:border-[#62A8F7] cursor-pointer">
            <Upload className="h-3.5 w-3.5 text-[#62A8F7]" />
            {videoUrl ? 'Replace Video' : 'Upload Video'}
            <input type="file" accept="video/*" onChange={handleVideoFile} className="hidden" />
          </label>
        </div>
        {parsedVideo && (
          <div className="flex items-center gap-3 pt-1">
            {parsedVideo.kind === 'youtube' ? (
              <img
                src={parsedVideo.thumbnailUrl}
                alt="Video preview"
                className="h-14 w-24 rounded-[8px] object-cover border border-[#252D38]"
              />
            ) : parsedVideo.kind === 'video' ? (
              <video
                src={parsedVideo.src}
                muted
                playsInline
                preload="metadata"
                className="h-14 w-24 rounded-[8px] object-cover border border-[#252D38]"
              />
            ) : (
              <div className="h-14 w-24 rounded-[8px] bg-[#171E29] border border-[#252D38] flex items-center justify-center text-[#62A8F7]">
                <Film className="h-5 w-5" />
              </div>
            )}
            <span className="text-[11px] text-[#929BAA]">
              {isUploadedVideo
                ? 'Uploaded video file attached'
                : parsedVideo.kind === 'youtube'
                  ? 'YouTube demonstration video linked'
                  : parsedVideo.kind === 'vimeo'
                    ? 'Vimeo demonstration video linked'
                    : 'Direct video URL linked'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
