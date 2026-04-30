import { z } from "zod";
import { BUILDING_CATEGORIES } from "@/types";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required").max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const buildingSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(255),
  abbreviation: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  category: z.enum(BUILDING_CATEGORIES as [string, ...string[]]),
  description: z.string().max(2000).optional().nullable(),
  polygonPoints: z.array(pointSchema).min(3).max(100),
  centerX: z.number().finite(),
  centerY: z.number().finite(),
  floors: z.number().int().min(0).max(500).optional().nullable(),
  departments: z.array(z.string().max(255)).max(100).optional(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Color must be a 6-digit hex value")
    .optional()
    .nullable(),
  imageUrl: z.string().min(1).max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
  locked: z.boolean().optional(),
});

export type BuildingInput = z.infer<typeof buildingSchema>;

export const buildingImportItemSchema = z.object({
  name: z.string().min(1).max(255),
  abbreviation: z
    .string()
    .min(1)
    .max(10)
    .transform((s) => s.toUpperCase()),
  category: z.enum(BUILDING_CATEGORIES as [string, ...string[]]),
  description: z.string().max(2000).optional().nullable(),
  polygonPoints: z.array(pointSchema).min(3).max(100),
  centerX: z.number().finite().optional(),
  centerY: z.number().finite().optional(),
  floors: z.number().int().min(0).max(500).optional().nullable(),
  departments: z.array(z.string().max(255)).max(100).optional(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Color must be a 6-digit hex value")
    .optional()
    .nullable(),
  imageUrl: z.string().min(1).max(500).optional().nullable(),
  locked: z.boolean().optional(),
});

export type BuildingImportItem = z.infer<typeof buildingImportItemSchema>;

export const buildingImportFileSchema = z.object({
  version: z.number().int().optional(),
  exportedAt: z.string().max(64).optional(),
  source: z
    .object({
      mapName: z.string().max(255).optional(),
      viewBoxWidth: z.number().optional(),
      viewBoxHeight: z.number().optional(),
    })
    .partial()
    .optional(),
  buildings: z.array(buildingImportItemSchema).min(1).max(500),
});

export type BuildingImportFile = z.infer<typeof buildingImportFileSchema>;

export const iotDeviceImportItemSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["light", "water_valve", "temp_humidity"]),
  state: z.boolean().optional(),
  locked: z.boolean().optional(),
  positionX: z.number().finite().min(0).optional(),
  positionY: z.number().finite().min(0).optional(),
  buildingId: z.string().uuid().nullable().optional(),
  temperature: z.number().finite().optional().nullable(),
  humidity: z.number().finite().min(0).max(100).optional().nullable(),
});

export type IotDeviceImportItem = z.infer<typeof iotDeviceImportItemSchema>;

export const iotDeviceImportFileSchema = z
  .object({
    version: z.number().int().optional(),
    exportedAt: z.string().max(64).optional(),
    source: z
      .object({
        mapName: z.string().max(255).optional(),
      })
      .partial()
      .optional(),
    devices: z.array(iotDeviceImportItemSchema).min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    const tempHumiCount = value.devices.filter(
      (device) => device.type === "temp_humidity",
    ).length;
    if (tempHumiCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one temp_humidity device is allowed per import file",
        path: ["devices"],
      });
    }
  });

export type IotDeviceImportFile = z.infer<typeof iotDeviceImportFileSchema>;

export const createMapSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().min(1).max(500),
  viewBoxWidth: z.number().int().positive().max(20_000).optional(),
  viewBoxHeight: z.number().int().positive().max(20_000).optional(),
});

export type CreateMapInput = z.infer<typeof createMapSchema>;

export const updateMapSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().min(1).max(500).optional(),
  viewBoxWidth: z.number().int().positive().max(20_000).optional(),
  viewBoxHeight: z.number().int().positive().max(20_000).optional(),
  isPublished: z.boolean().optional(),
  buildings: z.array(buildingSchema).max(500).optional(),
});

export type UpdateMapInput = z.infer<typeof updateMapSchema>;

export const deviceSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["light", "water_valve", "temp_humidity"]),
  positionX: z.number().finite().min(0).optional(),
  positionY: z.number().finite().min(0).optional(),
  buildingId: z.string().uuid().nullable().optional(),
  state: z.boolean().optional(),
  locked: z.boolean().optional(),
  temperature: z.number().finite().nullable().optional(),
  humidity: z.number().finite().min(0).max(100).nullable().optional(),
});

export type DeviceInput = z.infer<typeof deviceSchema>;

export const updateDeviceSchema = deviceSchema
  .pick({
    name: true,
    type: true,
    positionX: true,
    positionY: true,
    buildingId: true,
    state: true,
    locked: true,
    temperature: true,
    humidity: true,
  })
  .extend({
    boardTarget: z.enum(["esp32", "esp01"]).optional().nullable(),
    firmwareVersion: z.string().max(100).optional().nullable(),
    wifiSsid: z.string().max(255).optional().nullable(),
    otaStatus: z.string().max(50).optional().nullable(),
    lastSeenAt: z.string().datetime().optional().nullable(),
    registrationToken: z.string().max(255).optional().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  role: z.enum(["admin", "operator"]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).optional(),
    password: z.string().min(6).max(128).optional(),
    role: z.enum(["admin", "operator"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const firmwareBuildSchema = z.object({
  deviceType: z.enum(["light", "water_valve", "temp_humidity"]),
  boardTarget: z.enum(["esp32", "esp01"]),
  version: z.string().min(1).max(100),
  changelog: z.string().max(5000).optional().nullable(),
  originalFileName: z.string().min(1).max(255).optional(),
  binaryBase64: z.string().min(1),
});

export const otaPushSchema = z.object({
  mapId: z.string().uuid(),
  deviceIds: z.array(z.string().uuid()).min(1).max(1),
  firmwareBuildId: z.string().uuid(),
});

export const deviceBootLogSchema = z.object({
  mapId: z.string().uuid(),
  deviceId: z.string().uuid(),
  state: z.boolean(),
  firmwareVersion: z.string().min(1).max(100),
  wifiSsid: z.string().max(255).optional().nullable(),
  mqttTopicPrefix: z.string().min(1).max(255).optional().nullable(),
  boardTarget: z.enum(["esp32", "esp01"]).optional().nullable(),
});

export const registerStartSchema = z.object({
  mapId: z.string().uuid(),
  deviceId: z.string().uuid(),
  boardTarget: z.enum(["esp32", "esp01"]),
});

export const registerCompleteSchema = z.object({
  mapId: z.string().uuid(),
  deviceId: z.string().uuid(),
  registrationToken: z.string().min(8).max(255),
  boardTarget: z.enum(["esp32", "esp01"]),
  wifiSsid: z.string().max(255),
  mqttTopicPrefix: z.string().min(1).max(255),
  firmwareVersion: z.string().min(1).max(100),
});

export const otaAckSchema = z.object({
  deviceId: z.string().uuid(),
  mapId: z.string().uuid(),
  status: z.enum(["queued", "downloading", "flashing", "success", "failed"]),
  detail: z.string().max(2000).optional(),
});

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_MB = 25;
