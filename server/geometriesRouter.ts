import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createAuditLog } from "./db";

export const geometriesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        type: z.enum(["marker", "polyline", "polygon"]),
        name: z.string().min(1),
        description: z.string().optional(),
        coordinates: z.string(), // JSON string
        color: z.string().default("#3b82f6"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db.createGeometry({
        ...input,
        userId: ctx.user.id,
        visible: 1,
        opacity: 100,
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.create",
        entityType: "geometry",
        entityId: input.projectId,
        details: { name: input.name, type: input.type },
      });

      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return await db.getGeometriesByProject(input.projectId);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteGeometry(input.id);

      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.delete",
        entityType: "geometry",
        entityId: input.id,
        details: null,
      });

      return { success: true };
    }),

  updateVisibility: protectedProcedure
    .input(z.object({ id: z.number(), visible: z.number().min(0).max(1) }))
    .mutation(async ({ input }) => {
      await db.updateGeometryVisibility(input.id, input.visible);
      return { success: true };
    }),

  updateOpacity: protectedProcedure
    .input(z.object({ id: z.number(), opacity: z.number().min(0).max(100) }))
    .mutation(async ({ input }) => {
      await db.updateGeometryOpacity(input.id, input.opacity);
      return { success: true };
    }),
    
  export: protectedProcedure
    .input(z.object({
      geometryIds: z.array(z.number()),
      format: z.enum(["kml", "geojson"]),
    }))
    .mutation(async ({ input }) => {
      const { geometryIds, format } = input;
      
      // Buscar geometrias
      const geometries = await Promise.all(
        geometryIds.map(id => db.getGeometryById(id))
      );
      
      if (format === "geojson") {
        const features = geometries.map((g: any) => {
          if (!g) return null;
          const coords = JSON.parse(g.coordinates);
          let geometry;
          
          if (g.type === "marker") {
            geometry = { type: "Point", coordinates: [coords[1], coords[0]] };
          } else if (g.type === "polyline") {
            geometry = { type: "LineString", coordinates: coords.map((c: number[]) => [c[1], c[0]]) };
          } else if (g.type === "polygon") {
            geometry = { type: "Polygon", coordinates: [coords.map((c: number[]) => [c[1], c[0]])] };
          }
          
          return {
            type: "Feature",
            properties: {
              name: g.name,
              description: g.description,
              color: g.color,
            },
            geometry,
          };
        }).filter(Boolean);
        
        return {
          data: JSON.stringify({
            type: "FeatureCollection",
            features,
          }, null, 2),
          filename: `geometries_${Date.now()}.geojson`,
        };
      } else if (format === "kml") {
        let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n';
        
        geometries.forEach((g: any) => {
          if (!g) return;
          const coords = JSON.parse(g.coordinates);
          kml += `  <Placemark>\n    <name>${g.name}</name>\n`;
          if (g.description) {
            kml += `    <description>${g.description}</description>\n`;
          }
          
          if (g.type === "marker") {
            kml += `    <Point>\n      <coordinates>${coords[1]},${coords[0]},0</coordinates>\n    </Point>\n`;
          } else if (g.type === "polyline") {
            const coordsStr = coords.map((c: number[]) => `${c[1]},${c[0]},0`).join(" ");
            kml += `    <LineString>\n      <coordinates>${coordsStr}</coordinates>\n    </LineString>\n`;
          } else if (g.type === "polygon") {
            const coordsStr = coords.map((c: number[]) => `${c[1]},${c[0]},0`).join(" ");
            kml += `    <Polygon>\n      <outerBoundaryIs>\n        <LinearRing>\n          <coordinates>${coordsStr}</coordinates>\n        </LinearRing>\n      </outerBoundaryIs>\n    </Polygon>\n`;
          }
          
          kml += `  </Placemark>\n`;
        });
        
        kml += '</Document>\n</kml>';
        
        return {
          data: kml,
          filename: `geometries_${Date.now()}.kml`,
        };
      }
      
      throw new Error("Formato não suportado");
    }),
});
