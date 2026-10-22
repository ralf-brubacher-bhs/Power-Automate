# Power BI → PNG → correo con Power Automate

Guía práctica para (1) descomponer la URL de un reporte de Power BI y elegir la página correcta, (2) exportarla a PNG con Power Automate y (3) incrustar la imagen en un correo que Outlook muestre bien.

Fuentes oficiales de Microsoft Learn consultadas el 2026-10-09 (listadas al final). Cuando algo **no** está en la documentación oficial lo marco como **[inferido]** o **[verificar]**.

---

## 1. Anatomía de la URL de un reporte

Ejemplo (tomado de la documentación oficial):

```
https://app.powerbi.com/groups/338cd931-b957-4ba6-a5fa-b0113dab53aa/reports/85ac7583-3bb2-4c2c-a1fa-5a4a875ba88c/ReportSection?ctid=72f988bf-86f1-41af-91ab-2d7cd011db47
```

| Segmento | Valor de ejemplo | Qué es | Dónde se usa en Power Automate |
|---|---|---|---|
| `groups/{id}` | `338cd931-…53aa` | **Workspace ID** (`groupId`). `groups/me` = "Mi área de trabajo". | Campo **Workspace** |
| `reports/{id}` | `85ac7583-…a88c` | **Report ID** (`reportId`) | Campo **Report** |
| Segmento tras el reportId | `ReportSection` | **Nombre interno de la página** (`pageName`). No es el nombre visible de la pestaña. | Campo **pageName** (Pages - 1) |
| `?ctid=` | `72f988bf-…` | ID del tenant (Microsoft Entra). | No se usa en la exportación |
| `?bookmarkGuid=` | `Bookmark…` | Nombre interno de un **marcador de reporte** | Campo **Bookmark Name** |
| `?filter=` | `Tabla/Campo eq 'X'` | Filtro por URL | Campo **Filter** (sin el `?filter=`) |

**Regla para la página:** el `pageName` es el segmento entre el último `/` (después del reportId) y el `?`. Microsoft indica que la primera página suele llamarse `ReportSection` y las siguientes `ReportSection1`, `ReportSection2` o un nombre propio.

**[inferido]** En reportes creados o guardados en versiones recientes es frecuente ver identificadores hexadecimales (p. ej. `/reports/<id>/a1b2c3d4e5f6a7b8c9d0`) en lugar de `ReportSection…`. Se usan igual: copie el segmento literal.

**Forma más robusta (recomendada):** en lugar de leer la URL a mano, liste las páginas con la API REST *Get Pages In Group* (`GET https://api.powerbi.com/v1.0/myorg/groups/{groupId}/reports/{reportId}/pages`). Devuelve `name` (el que necesita la exportación) y `displayName` (el que ve el usuario). La documentación de exportación indica que los nombres de página válidos son exactamente los que devuelve esa API.

**Atención con las Apps de Power BI [verificar]:** si la URL es del tipo `/groups/me/apps/{appId}/reports/{id}/…`, el ID que aparece corresponde a la copia publicada en la App. Para exportar, use el ID del reporte **en el workspace de origen**.

### Visual individual (opcional)
Para exportar un solo visual: abra el reporte en modo **Edición** → seleccione el visual → **Formato del visual** → **General** → **Propiedades** → copie **Nombre**. Ese valor va en `visualName` junto con su `pageName`.

---

## 2. Requisitos previos (bloqueantes)

1. **Capacidad:** el reporte, y todos sus modelos semánticos (también los DirectQuery), deben estar en un workspace con capacidad **Premium, Embedded o Fabric**. **No funciona con Premium Per User (PPU)** ni con un workspace solo Pro.
2. **Configuración del tenant (portal de administración):**
   - *Export reports as PowerPoint presentations or PDF documents*: activado por defecto.
   - ***Export reports as image files***: **es obligatorio para PNG y viene desactivado por defecto.**
3. **Conector:** Power BI es un conector **Standard** de Power Automate, incluido en las licencias de Microsoft 365. La conexión es OAuth del usuario y **no se puede compartir**.
4. **Permisos:** el usuario de la conexión necesita acceso al reporte. Para exportar con **RLS** (identidades) necesita además permiso de *Write* sobre el modelo semántico y rol *Contributor* o *Admin* en el workspace.

---

## 3. El flujo en Power Automate

```
Recurrence (programado)
  └─ Power BI · Export To File for Power BI Reports
       Workspace      = <groupId>
       Report         = <reportId>
       Export Format  = PNG
       Pages pageName - 1   = ReportSection2          ← la página elegida
       (opcional) visualName, Bookmark Name, Filter, Locale, Identities (RLS)
  └─ Office 365 Outlook · Send an email (V2)  (o alternativa del punto 4)
```

### Parámetros de la acción "Export To File for Power BI Reports"

| Parámetro | Uso | Notas |
|---|---|---|
| Export Format | `PNG` | También admite PDF y PPTX |
| Pages · pageName | Página a exportar | Si indica **una** página, obtiene **un .png**. Si exporta varias páginas (o el reporte completo), recibe **un .zip** con un PNG por página. |
| Pages · visualName | Un solo visual de esa página | Opcional |
| Bookmark Name / State | Estado de la página | Solo **marcadores de reporte**. Los marcadores personales y los filtros persistentes **no** son compatibles. Use Name **o** State, no ambos. |
| Filter | Filtro por URL sin `?filter=` | Ej.: `Centro/Region eq 'Norte'`. **Solo se admite 1 filtro de nivel de reporte**, aunque puede combinar condiciones con `and`. |
| Locale | Formato regional | Ej.: `es-AR` |
| Include Hidden Pages | Páginas ocultas | Se ignora si indica páginas concretas |
| Identities (Username, Datasets, Roles) | RLS | Útil para enviar a cada sede o servicio solo sus datos |

### Ejemplos de filtro (sintaxis oficial de URL)

```
Pacientes/Servicio eq 'Cardiología'
Pacientes/Servicio in ('Cardiología', 'Pediatría')
Atenciones/Fecha ge 2026-09-01 and Atenciones/Fecha lt 2026-10-01
Sedes_x0020_Activas/Nombre eq 'Sede Centro'      ← un espacio en el nombre de la tabla va como _x0020_
Medicos/Apellido eq 'O''Brien'                    ← la comilla simple se escapa duplicándola
```

Reglas importantes: los nombres de **tabla y campo distinguen mayúsculas** (el valor no); el texto va entre comillas simples y los números sin comillas; no se puede filtrar sobre tablas o columnas que empiecen por `INF` en mayúsculas; el límite es de 10 expresiones unidas por `and`. Si la página ya tiene filtros guardados, se combinan con AND y pueden dejar el visual vacío.

**Sin bookmark ni filtro, la exportación usa los valores por defecto guardados** (incluidos los segmentadores). Si cambia un segmentador en pantalla y no guarda el reporte, el PNG no lo refleja.

---

## 4. Incrustar el PNG en el correo (Outlook)

Hay tres opciones, de menor a mayor robustez:

### A. Data URI en "Send an email (V2)" (la más simple)
Body en vista de código (`</>`):

```html
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="font-family:Arial,sans-serif;font-size:14px;">Indicadores del día</td></tr>
  <tr><td>
    <img src="data:image/png;base64,@{body('Export_To_File_for_Power_BI_Reports')?['$content']}"
         width="600" alt="Tablero de indicadores - Servicio de Cardiología" style="display:block;border:0;">
  </td></tr>
</table>
```

**[verificar]** El contenido binario suele exponerse como `{"$content-type": "...", "$content": "<base64>"}`. Si `?['$content']` sale vacío, use `base64(body('Export_To_File_for_Power_BI_Reports'))`. Pruébelo en una ejecución y revise la salida de la acción.

Limitaciones de esta opción:
- La documentación de Power Automate indica que **las imágenes inline se limitan a 100 KB**, lo que puede degradar la calidad. Un PNG de una página completa de Power BI suele superar ese tamaño **[inferido]**. Exporte un **visual** en lugar de la página entera, o use la opción C.
- **[inferido, no documentado por Microsoft]** Muchos clientes, entre ellos Gmail y algunas versiones de Outlook clásico para Windows, bloquean o no muestran imágenes `data:`. Microsoft documenta además un problema en Outlook clásico: las imágenes Base64 se corrompen al **reenviar** desde un buzón compartido con el modo caché desactivado. Su alternativa oficial es enviar la imagen como adjunto.
- Base64 aumenta el tamaño entre un 30 % y un 40 %.

### B. Adjunto simple (lo que muestra el tutorial oficial)
En *Send an email (V2)*: **Attachments Name** = `indicadores.png` y **Attachments Content** = `File Content` de la acción de exportación. Es la opción más fiable, pero la imagen no aparece dentro del cuerpo.

### C. Imagen inline por CID (recomendada para Outlook)
*Send an email (V2)* no permite marcar un adjunto como inline. Para hacerlo, envíe el correo con **Microsoft Graph** (`POST /users/{id}/sendMail`), por ejemplo con la acción *Send an HTTP request* del conector Office 365 Outlook o con un conector HTTP:

```json
{
  "message": {
    "subject": "Indicadores diarios",
    "body": { "contentType": "HTML",
      "content": "<img src=\"cid:tablero1\" width=\"600\" alt=\"Tablero\">" },
    "toRecipients": [{ "emailAddress": { "address": "direccion@ejemplo.org" } }],
    "attachments": [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      "name": "tablero1.png",
      "contentType": "image/png",
      "contentId": "tablero1",
      "isInline": true,
      "contentBytes": "@{body('Export_To_File_for_Power_BI_Reports')?['$content']}"
    }]
  }
}
```

Graph define `isInline` y `contentId`, y la imagen se referencia con `<img src="cid:…">`. Es el mecanismo estándar y el que mejor renderiza Outlook, tanto el clásico como el nuevo y la web.

**Buenas prácticas de HTML para Outlook clásico de Windows**, que usa el motor de Word: maquetar con `<table>`, estilos inline, ancho fijo (600–700 px) con `width` como **atributo** del `<img>`, `alt` descriptivo y nada de CSS externo, flexbox ni grid.
---

## 5. Límites y consideraciones

| Tema | Límite / comportamiento | Fuente |
|---|---|---|
| Tamaño del archivo exportado | Máx. **250 MB** | Export to file |
| Páginas/visuales por exportación | Máx. **50**; si hay más, el trabajo se cancela | Export to file |
| Concurrencia | 500 solicitudes por capacidad (error 429 si se supera); 5 páginas en paralelo por trabajo | Export to file |
| Throttling del conector Power BI | **100 llamadas / 60 s por conexión** | Conector Power BI |
| Throttling de Outlook | 300 llamadas / 60 s | Troubleshoot email |
| Carga en la capacidad | Cuenta como operación de **fondo lenta** y consume CU | Export to file |
| Etiquetas de confidencialidad | **No se aplican al PNG** (sí a PDF y PPTX) | Export to file |
| Visuales no compatibles | R, Python, Power Apps, Power Automate, Visio, ArcGIS, visual de reporte paginado y visuales personalizados **no certificados**: aparece un símbolo de error en su lugar | Export to file |
| SSO | Modelos compuestos con origen SSO: no compatible | Export to file |
| Mensaje en Exchange Online | 35 MB de envío por defecto (configurable) | Exchange Online limits |
| Nubes soberanas | El conector no funciona en China, Alemania ni US Gov | Conector Power BI |

### Aspectos no documentados con claridad
- **Tiempo de espera [verificar]:** la API es asíncrona. El conector hace el sondeo internamente, pero Microsoft no publica cuánto espera la acción antes de fallar. En reportes pesados conviene configurar la **directiva de reintento** de la acción y medir tiempos reales.
- **Resolución del PNG [no documentado]:** no hay ningún parámetro de DPI ni de tamaño. La imagen sale con el tamaño de lienzo de la página (por defecto 16:9, 1280×720). Para controlar el resultado, ajuste el tamaño de la página en Power BI Desktop (p. ej. un tamaño personalizado de 600 px de ancho para correo).
- **Datos actualizados [inferido]:** la exportación usa los datos del modelo en ese momento. Si el correo debe salir tras una actualización, encadene *Refresh a dataset* o programe el envío después de la actualización programada.

### Salud: datos sensibles
El PNG **pierde la etiqueta de confidencialidad** y el correo puede reenviarse. Para información clínica o de pacientes: use RLS (Identities) para que cada destinatario reciba solo lo suyo, prefiera indicadores agregados en la imagen y valore enviar un **enlace** al reporte (que respeta permisos y RLS) en lugar de la imagen.

---

## 6. Checklist rápido
1. [ ] Workspace en capacidad Premium/Fabric/Embedded (no PPU)
2. [ ] Tenant: "Export reports as image files" activado
3. [ ] groupId, reportId y pageName obtenidos (idealmente con *Get Pages In Group*)
4. [ ] Exportar **una** página o visual (si no, recibirá un .zip)
5. [ ] Filtro, bookmark o RLS definidos (si no, se usan los valores por defecto guardados)
6. [ ] Imagen inline por CID (Graph) o adjunto; data URI solo si pesa menos de 100 KB y se probó en los clientes reales
7. [ ] Directiva de reintentos y prueba en Outlook clásico, nuevo Outlook y móvil

---

## Fuentes (Microsoft Learn)
- Export and email a Power BI report with Power Automate: https://learn.microsoft.com/power-bi/collaborate-share/service-automate-power-bi-report-export
- Export Power BI report to file (requisitos, límites, filtros, bookmarks): https://learn.microsoft.com/power-bi/developer/embedded/export-to
- Reports - Export To File In Group (REST): https://learn.microsoft.com/rest/api/power-bi/reports/export-to-file-in-group
- Reports - Get Pages In Group (REST): https://learn.microsoft.com/rest/api/power-bi/reports/get-pages-in-group
- Conector Power BI (parámetros, throttling): https://learn.microsoft.com/connectors/powerbi/
- Filtrar un reporte con parámetros de URL: https://learn.microsoft.com/power-bi/collaborate-share/service-url-filters
- Customize email in flows (límite de 100 KB para imágenes inline): https://learn.microsoft.com/power-automate/email-customization
- Office 365 Outlook – Known issues and limitations: https://learn.microsoft.com/connectors/office365/#known-issues-and-limitations
- Troubleshoot email in flows: https://learn.microsoft.com/power-automate/email-troubleshooting
- Graph fileAttachment (isInline, contentId): https://learn.microsoft.com/graph/api/resources/fileattachment
- Office Add-ins known issues (Base64 en Outlook clásico): https://learn.microsoft.com/office/dev/add-ins/resources/resources-office-add-in-known-issues
- Exchange Online limits: https://learn.microsoft.com/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits
