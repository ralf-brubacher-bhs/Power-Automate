# Power Automate para reportes de Power BI por correo

Documentación de referencia para construir, operar y gobernar los flujos de Power Automate que toman datos de Power BI y los envían por correo, en el contexto de una empresa de salud.

- **Fuentes:** Microsoft Learn, consultado el 2026-10-22 (lista al final). Lo que **no** está en la documentación oficial va marcado como **[inferido]** o **[verificar]**.
- **Complementa** a [power-bi-url-and-png-power-automate.md](power-bi-url-and-png-power-automate.md). Allí están el detalle de la URL del reporte, los parámetros de *Export To File*, la sintaxis de filtros y las tres formas de incrustar la imagen en Outlook. Este documento no lo repite: remite a esas secciones.

---

## 1. Qué patrón elegir

Hay cuatro formas de llevar datos de Power BI a un correo. Conviene decidir primero cuál corresponde a cada reporte.

| Patrón | Qué recibe el destinatario | Cuándo usarlo | Requisito clave |
|---|---|---|---|
| **A. Suscripción nativa de Power BI** (sin Power Automate) | Imagen de la página y enlace, o adjunto | Envíos simples, destinatarios internos, sin lógica | Ver límites en §8 |
| **B. Exportar el reporte** (*Export To File for Power BI Reports*) | PNG, PDF o PPTX | Se necesita la imagen o el PDF del tablero, con filtros o RLS por destinatario | Capacidad Premium, Fabric o Embedded (no PPU). Detalle en la guía PNG |
| **C. Consultar el modelo** (*Run a query against a dataset*, DAX) | Tabla HTML con los números en el cuerpo | Indicadores puntuales, alertas, texto que se lee bien en cualquier cliente de correo | Funciona en Pro, PPU y Premium |
| **D. Reporte paginado** (*Export To File for Paginated Reports*) | PDF, XLSX, DOCX, CSV, etc. | Listados operativos largos o con formato de impresión | Capacidad Premium o Fabric **[verificar]** según el tipo de workspace |

**Recomendación para salud [inferido]:** usar **C** para indicadores agregados en el cuerpo del correo (no depende de cómo Outlook muestre imágenes y no viaja ningún archivo), **B** cuando el destinatario necesita ver el tablero, y **A** solo si no hace falta ninguna lógica. En todos los casos, enviar indicadores agregados y no datos identificables de pacientes (ver §7.6).

---

## 2. El conector de Power BI

Fuente: [Conector Power BI](https://learn.microsoft.com/connectors/powerbi/).

### 2.1 Características generales

- **Clase: Standard** en Power Automate. No requiere licencia Premium de Power Automate.
- **Autenticación:** solo OAuth del usuario que inicia sesión. La conexión **no se puede compartir**: cada flujo usa la identidad de la persona que creó la conexión. No hay opción de entidad de servicio (*service principal*) en este conector.
- **Throttling:** **100 llamadas por conexión cada 60 segundos**.
- **No funciona** en las nubes soberanas de Power BI (China, Alemania, US Government).

### 2.2 Acciones útiles para reportes por correo

| Acción | Para qué sirve | Notas |
|---|---|---|
| **Export To File for Power BI Reports** | Exporta un reporte a PNG, PDF o PPTX | Admite página, visual, marcador, filtro, configuración regional e identidades RLS. Ver la guía PNG, §2 a §5 |
| **Export To File for Paginated Reports** | Exporta un reporte paginado | Formatos: PPTX, PDF, ACCESSIBLEPDF, XLSX, DOCX, CSV, XML, MHTML e imagen (BMP, EMF, GIF, JPEG, PNG, TIFF). Acepta parámetros del reporte |
| **Run a query against a dataset** | Ejecuta una consulta **DAX** y devuelve filas en JSON (`firstTableRows`) | Parámetros: workspace, modelo, consulta, *Nulls included*, *Impersonate user* (UPN, para RLS) |
| **Run a json query against a dataset** | La misma API con el cuerpo JSON completo | Para quien ya tiene el cuerpo de la API REST |
| **Refresh a dataset** | Pide una actualización del modelo semántico | Ver §4.3: no espera a que la actualización termine **[inferido]** |
| **Add rows to a dataset** | Inserta filas en un modelo *push* | La transmisión en tiempo real de Power BI está anunciada para retiro; no usarla en diseños nuevos |

### 2.3 Desencadenadores (triggers)

| Trigger | Uso |
|---|---|
| **When a data driven alert is triggered** | Arranca el flujo cuando salta una alerta de datos configurada en un **icono de dashboard** de Power BI (no en un reporte). Devuelve título, umbral, valor e URL del icono |
| Triggers de **metas/scorecards** (*Preview*) | Cambio de estado o valor de una meta. Sondeo mínimo cada 300 s. En vista previa: no usarlos en producción |

Para envíos periódicos el trigger es **Recurrence** (§4), no uno del conector.

### 2.4 Consulta DAX desde el flujo (patrón C)

La acción usa la API REST *Datasets - Execute Queries*. Límites oficiales ([referencia](https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries)):

- El administrador debe tener activada la opción de tenant **Dataset Execute Queries REST API**.
- El usuario de la conexión necesita permisos de **Read y Build** sobre el modelo.
- Una consulta por llamada y **una tabla** por consulta.
- Máximo **100.000 filas o 1.000.000 de valores** (lo que ocurra primero) y **15 MB** por consulta. Si se supera, la respuesta es **HTTP 200 con datos truncados**, no un error. Conviene validar el número de filas.
- **120 consultas por minuto por usuario**, sea cual sea el modelo.
- Solo DAX (no MDX, DMV ni funciones INFO). No admite modelos en Azure Analysis Services.
- Con **RLS**, `impersonatedUserName` permite ejecutar la consulta como otro usuario y obtener solo sus filas. Las entidades de servicio no son compatibles con modelos que tienen RLS o SSO.

Ejemplo de consulta para un correo de indicadores diarios (los nombres de tabla y medida son ilustrativos):

```dax
EVALUATE
SUMMARIZECOLUMNS(
    Sedes[Sede],
    "Turnos",          [Total Turnos],
    "Ausentismo %",    ROUND([Tasa Ausentismo] * 100, 1),
    "Espera media min",ROUND([Espera Media Minutos], 0)
)
ORDER BY Sedes[Sede]
```

Microsoft recomienda devolver solo las columnas necesarias, preferir `SUMMARIZECOLUMNS` y limitar filas con `TOPN` ([buenas prácticas DAX por API](https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/best-practices)).

Las claves del JSON vienen como `Sedes[Sede]` o `[Turnos]`. Para armar la tabla del correo use **Select** para renombrarlas y luego **Create HTML table**:

```
Select
  From: @{outputs('Run_a_query_against_a_dataset')?['body/firstTableRows']}
  Map:  Sede        -> @{item()?['Sedes[Sede]']}
        Turnos      -> @{item()?['[Turnos]']}
        Ausentismo  -> @{item()?['[Ausentismo %]']}
```

**[inferido]** *Create HTML table* genera un `<table>` sin estilos. Outlook clásico de Windows (motor de Word) ignora el CSS en `<style>` de forma irregular. Para un resultado estable, arme la tabla con estilos en línea (por ejemplo con `replace()` sobre el HTML generado o construyendo las filas con *Select* + `join()`), con el criterio de maquetación de la guía PNG, §4. El comportamiento de Outlook con HTML se tratará en detalle en una guía aparte.

---

## 3. Exportación a archivo (patrón B y D)

Todo lo relativo a PNG, la URL, `pageName`, filtros, marcadores, RLS, límites de la exportación y cómo incrustar la imagen está en la guía PNG. Resumen de lo que afecta al diseño del flujo:

- La exportación es **asíncrona**. El conector espera internamente y devuelve el archivo. Microsoft no publica cuánto espera la acción antes de fallar **[verificar]**. Configure una política de reintentos (§6).
- Una página da un archivo. Varias páginas en PNG dan un **.zip**.
- Cuenta como operación de fondo en la capacidad y consume unidades de capacidad (CU). Programe los envíos masivos fuera de las horas de uso intenso **[inferido]**.
- El PNG **pierde la etiqueta de confidencialidad**. PDF y PPTX la conservan.

---

## 4. Programación

Fuente: [Run a cloud flow on a schedule](https://learn.microsoft.com/power-automate/run-scheduled-tasks).

### 4.1 Trigger Recurrence

- Configure **siempre** la **zona horaria** y la **hora de inicio** (formato `YYYY-MM-DDTHH:MM:SSZ`). Si no se fija la hora de inicio, el flujo puede ejecutarse antes de lo previsto ([solución de problemas de triggers](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot)).
- Con una zona horaria local (por ejemplo *(UTC-03:00) Buenos Aires*), el horario sigue la hora local. Con UTC, hay que recalcularlo si el país cambia de horario **[inferido]**.
- Use **On these days** y **At these hours / minutes** para fijar días hábiles y horas exactas.
- Intervalo mínimo: **60 s**; máximo: **500 días**.

### 4.2 Fechas en el contenido

Las fechas en Power Automate suelen ir en UTC. Para el asunto y el cuerpo use **Convert time zone** o la expresión:

```
convertTimeZone(utcNow(), 'UTC', 'Argentina Standard Time', 'dd/MM/yyyy')
```

([Convertir zona horaria](https://learn.microsoft.com/power-automate/convert-time-zone)). El nombre de la zona sigue el formato de Windows **[verificar]** el que corresponda a su país.

### 4.3 Enviar con datos actualizados

- **Opción recomendada [inferido]:** dejar la actualización en la **programación del modelo** en Power BI y programar el flujo con margen después de la ventana de actualización. En capacidad compartida el límite es de 8 actualizaciones programadas por día; en Premium, PPU o Fabric, 48 ([Data refresh in Power BI](https://learn.microsoft.com/power-bi/connect-data/refresh-data)).
- **Refresh a dataset** solo **pide** la actualización. La API es asíncrona, así que la acción termina antes que la actualización **[inferido]**. Para esperar el resultado habría que consultar `GET .../datasets/{id}/refreshes?$top=1` en un bucle *Do until*, lo que requiere un conector HTTP con Microsoft Entra ID. Ese conector es **Premium** **[verificar]** la licencia en su tenant.
- Las actualizaciones lanzadas por API **no envían el correo de error** de Power BI. Si las usa, el flujo tiene que avisar del fallo.
- Power BI **pausa la actualización programada** de un modelo si nadie visita sus reportes en dos meses. Si los usuarios solo consumen el correo exportado, puede ocurrir. Una suscripción nativa sobre el reporte evita la pausa ([refresh-data](https://learn.microsoft.com/power-bi/connect-data/refresh-data); [suscripciones](https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe)).

### 4.4 Disparo por alerta

Para avisos por umbral (por ejemplo, ocupación de camas mayor que 90 %), configure una alerta de datos en un icono de dashboard y use el trigger *When a data driven alert is triggered*. Así evita sondear con *Recurrence*.

---

## 5. Licencias y límites

### 5.1 Licencias de Power Automate

Fuentes: [Request limits and allocations](https://learn.microsoft.com/power-platform/admin/api-request-limits-allocations), [Limits and configuration](https://learn.microsoft.com/power-automate/limits-and-config), [Licensing FAQ](https://learn.microsoft.com/power-platform/admin/power-automate-licensing/faqs).

- **Power BI** y **Office 365 Outlook** son conectores **Standard**: un flujo que solo usa estos conectores funciona con la licencia de **Microsoft 365** del propietario.
- Necesita **Power Automate Premium** (por usuario) o **Process** (por flujo) si usa conectores Premium: HTTP, HTTP con Microsoft Entra ID, Dataverse, Azure Key Vault, etc.
- Un flujo **usa la licencia de su propietario**. Si el propietario deja la organización, el flujo baja al perfil de rendimiento *Low*.

**Solicitudes de Power Platform (PPR) por 24 h.** Cada trigger y cada acción cuentan como una solicitud, incluidas las que se ejecutan dentro de bucles, los reintentos y la paginación.

| Licencia | Límite oficial | Límite en el período de transición actual |
|---|---|---|
| Microsoft 365 / Office 365 | 6.000 por usuario | 10.000 por flujo |
| Power Automate Premium | 40.000 por usuario | 200.000 por flujo |
| Power Automate Process | 250.000 por licencia (apilable hasta 10 en un flujo) | 500.000 por licencia |

Además, todas las licencias tienen un límite de **100.000 solicitudes cada 5 minutos**.

**Estimación [inferido]:** un envío diario con 1 trigger, 1 consulta, *Select*, *Create HTML table*, *Compose* y 1 correo son unas 6 solicitudes. Un bucle de 30 sedes con exportación y correo por sede son unas 100 solicitudes por ejecución. Las dos opciones caben con holgura en una licencia de Microsoft 365. Al escalar, el límite que se alcanza antes es el **throttling del conector**: 100 llamadas/min en Power BI y 300 llamadas/min en Outlook.

### 5.2 Límites de la plataforma

| Límite | Valor | Fuente |
|---|---|---|
| Duración de una ejecución | 30 días | limits-and-config |
| Retención del historial de ejecuciones | 30 días | limits-and-config |
| Solicitud saliente síncrona | 120 s (las acciones asíncronas pueden durar más) | limits-and-config |
| Tamaño de mensaje | 100 MB (1 GB con fragmentación, si la acción la admite) | limits-and-config |
| Acciones por flujo / anidamiento | 500 / 8 niveles | limits-and-config |
| Caracteres por expresión | 8.192 | limits-and-config |
| Flujos por usuario (fuera de soluciones) | 600 | limits-and-config |
| Flujo con errores continuos | Se apaga a los **14 días** | limits-and-config |
| Flujo sin ejecuciones | Puede apagarse a los **90 días** (no aplica con licencia Premium o Process; se avisa 30 días antes) | limits-and-config |
| Flujo con throttling constante | Se apaga a los 14 días | limits-and-config |

Los límites de Power BI (exportación, consultas) y de Exchange (35 MB por mensaje) están en §2.4 y en la guía PNG, §5.

---

## 6. Diseño robusto del flujo

Fuente: [Employ robust error handling](https://learn.microsoft.com/power-automate/guidance/coding-guidelines/error-handling).

### 6.1 Estructura recomendada

```
Recurrence  (zona horaria + hora de inicio)
├─ Initialize variables / Compose de configuración   ← lee variables de entorno
├─ Scope "Try"
│   ├─ Power BI · Run a query against a dataset       (o Export To File)
│   ├─ Select + Create HTML table / Compose del cuerpo
│   └─ Office 365 Outlook · Send an email from a shared mailbox (V2)
├─ Scope "Catch"   (Configure run after: has failed, has timed out)
│   ├─ Filter array sobre result('Try')  → error real
│   ├─ Compose: URL de la ejecución (workflow())
│   └─ Notificar al equipo de soporte (Teams o correo)
└─ Scope "Finally" (opcional: registro en una lista o tabla)
```

### 6.2 Reglas

1. **Try/Catch con Scopes** y *Configure run after*. Ponga la notificación de error en el *Catch*, no en cada acción.
2. **Política de reintentos exponencial** en las acciones de Power BI (exportación y consulta). Cada reintento cuenta como solicitud.
3. **Enlace a la ejecución** en el aviso de error, construido con `workflow()`:
   `https://make.powerautomate.com/environments/@{workflow()?['tags']?['environmentName']}/flows/@{workflow()?['tags']?['logicAppName']}/runs/@{workflow()?['run']?['name']}`
4. **Idempotencia.** Power Automate garantiza "al menos una vez", así que una acción puede ejecutarse dos veces y enviar correos duplicados ([triggers troubleshoot](https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot)). En envíos críticos, registre la clave `fecha + reporte + destinatario` antes de enviar y compruébela.
5. **Validar los datos antes de enviar.** Si la consulta devuelve 0 filas, o justo el máximo (señal de truncado), no envíe y avise.
6. **Para enviar a muchos destinatarios**, use *Apply to each* con el **control de simultaneidad** ajustado para no superar los límites del conector **[inferido]**: 100/min en Power BI y 300/min en Outlook.
7. **Remitente:** use *Send an email from a shared mailbox (V2)* con un buzón institucional (p. ej. `reportes@…`), así las respuestas no llegan al buzón personal del propietario del flujo **[inferido]**.

---

## 7. Gobierno y seguridad

### 7.1 Entornos

- **No construya los flujos de producción en el entorno predeterminado** (*Default*): todos los empleados tienen acceso a él. Microsoft recomienda **entornos dedicados** para datos muy confidenciales ([Manage the default environment](https://learn.microsoft.com/power-platform/guidance/adoption/manage-default-environment)).
- Separación mínima **[inferido]:** *Desarrollo* → *Producción* (y *Prueba* si hay más de un desarrollador).
- Active **Managed Environments** en producción: límites de uso compartido, información de uso y recomendaciones de seguridad ([Secure the default environment](https://learn.microsoft.com/power-platform/guidance/adoption/secure-default-environment)). **[verificar]** Managed Environments requiere que los usuarios tengan licencias Premium.
- **Región del entorno:** elija la región de datos que exija la normativa local al crear el entorno **[inferido]**.

### 7.2 Soluciones y ALM

- Cree los flujos **dentro de una solución**. Es necesario para asignar licencias Process, para usar variables de entorno y para que el historial de ejecuciones se guarde en Dataverse.
- **Connection references:** desacoplan la conexión del flujo. En cada entorno se asigna la conexión correspondiente sin editar el flujo ([Pre-populate connection references](https://learn.microsoft.com/power-platform/alm/conn-ref-env-variables-build-tools)).
- **Variables de entorno** para todo lo que cambia entre entornos: IDs de workspace, reporte y modelo, listas de destinatarios, buzón remitente, canal de soporte ([Create environment variables](https://learn.microsoft.com/power-automate/environment-variables)). Limitación: si cambia el valor directamente en el entorno, el flujo sigue usando el valor anterior hasta que se guarde o se apague y encienda de nuevo.
- Mueva el flujo entre entornos como **solución administrada** (*managed*), con Pipelines de Power Platform o Build Tools.

### 7.3 Identidad del flujo

- Como el conector de Power BI usa la identidad del usuario y no se comparte (§2.1), **[inferido]** use una **cuenta de servicio** dedicada (no personal) con estas condiciones:
  - licencia que cubra Power Automate y acceso de lectura al workspace;
  - permiso **Build** en el modelo si usa consultas DAX;
  - rol **Contributor** en el workspace si exporta con identidades RLS (guía PNG, §2);
  - MFA y acceso condicional según la política de la organización. **[verificar]** que no interrumpan la renovación del token de la conexión.
- Agregue **copropietarios** (un grupo de seguridad) para que el flujo no quede huérfano.

### 7.4 Políticas de datos (DLP)

Fuentes: [Data policy strategy](https://learn.microsoft.com/power-platform/guidance/adoption/dlp-strategy), [Connector classification](https://learn.microsoft.com/power-platform/admin/dlp-connector-classification).

- Coloque **Power BI**, **Office 365 Outlook**, **SharePoint**, **Teams** y **Dataverse** en el grupo **Business**. Un flujo no puede combinar conectores *Business* con *Non-business*.
- **Bloquee** en el entorno de producción los conectores de consumo (Gmail, Dropbox, redes sociales, etc.) para que los datos de salud no salgan por ellos. Los conectores Standard de Microsoft no se pueden bloquear, solo clasificar.
- **Cuidado con los conectores HTTP:** si los bloquea, también deja de funcionar *Run a Child Flow*, que depende de ellos internamente.
- Un flujo que infringe la política se guarda pero queda **suspendido**.
- Las **Advanced connector policies** (lista de permitidos, todo bloqueado por defecto) son la evolución del modelo. Por ahora solo cubren conectores certificados.

### 7.5 Ocultar datos en el historial

El historial de ejecuciones guarda **entradas y salidas de cada acción durante 30 días**. Lo puede ver cualquier propietario o copropietario del flujo. En salud:

- Active **Secure inputs** y **Secure outputs** (Configuración → Seguridad) en la consulta DAX, la exportación, *Select* y el envío de correo ([Secure data used in cloud flows](https://learn.microsoft.com/power-automate/guidance/coding-guidelines/use-secure-inputs-outputs-triggers)).
- No escriba secretos en el flujo. Use **Azure Key Vault**, con variables de entorno de tipo secreto o con el conector (Premium).
- **[inferido, basado en Logic Apps]** Algunas acciones integradas (*Compose*, *Parse JSON*, variables) no tienen *Secure outputs*. Evite dejar datos sensibles en ellas o asegure la acción siguiente.

### 7.6 Datos de salud y cumplimiento

- Power Automate, Power BI y Exchange Online están dentro del **HIPAA Business Associate Agreement** de Microsoft, incluido por defecto en los términos de los servicios en línea, y tienen certificación **HITRUST CSF**. Microsoft aclara que el BAA **no** garantiza el cumplimiento por sí solo: la configuración y el uso son responsabilidad del cliente ([HIPAA/HITECH](https://learn.microsoft.com/compliance/regulatory/offering-hipaa-hitech)).
- **Fuera de EE. UU. [inferido]:** aplique la ley local de protección de datos. En Argentina, la Ley 25.326 clasifica los datos de salud como **datos sensibles**. Confirme el encuadre con el área legal o de cumplimiento.
- Prácticas mínimas para el contenido del correo **[inferido]:**
  1. Enviar **indicadores agregados**, nunca nombres, documentos ni diagnósticos de pacientes.
  2. Si un destinatario necesita detalle, enviar un **enlace al reporte**, que respeta permisos y RLS, en lugar del dato.
  3. Usar RLS (`impersonatedUserName` o *Identities*) para que cada sede o servicio reciba solo lo suyo.
  4. Aplicar **etiquetas de confidencialidad** de Microsoft Purview al correo. Recuerde que el PNG no hereda la etiqueta del reporte.
  5. Revisar quién tiene acceso al flujo, porque el historial guarda los datos (§7.5).

### 7.7 Monitoreo

- La **analítica** del flujo y el **centro de automatización** (*Automation center*) muestran ejecuciones y errores.
- El **CoE Starter Kit** sirve para el inventario de flujos huérfanos, conectores en uso y cumplimiento ([CoE tenant hygiene](https://learn.microsoft.com/power-platform/guidance/coe/after-setup-tenant-hygiene)).

---

## 8. Cuándo basta una suscripción nativa de Power BI

Fuente: [Email subscriptions](https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe).

Conviene una suscripción nativa si el envío es fijo, a destinatarios internos y sin lógica. Cambie a Power Automate cuando choque con alguno de estos límites:

- **24 suscripciones** por reporte o dashboard (los reportes paginados no tienen este límite).
- **Destinatarios externos** solo desde workspaces con capacidad paga (no PPU ni prueba).
- **60 minutos** como máximo de ejecución.
- Con **RLS**, el contenido refleja los permisos de quien crea la suscripción. Riesgo de exponer datos.
- **Visuales no admitidos:** visuales personalizados no certificados, ArcGIS, Power Apps, Power Automate, visual de reporte paginado y Visio.
- **Suscripciones dinámicas por destinatario** (reportes paginados): máximo 1.000 destinatarios y 10 minutos.
- En el cambio de horario de verano pueden llegar correos duplicados.

---

## 9. Checklist de puesta en producción

1. [ ] Patrón elegido por reporte (§1) y datos limitados a indicadores agregados (§7.6)
2. [ ] Entorno dedicado de producción, Managed Environment y política DLP aplicada (§7.1, §7.4)
3. [ ] Flujo dentro de una solución, con *connection references* y variables de entorno (§7.2)
4. [ ] Cuenta de servicio como propietaria, grupo como copropietario y permisos de Power BI verificados (§7.3)
5. [ ] Tenant de Power BI: *Dataset Execute Queries REST API* (para DAX) y *Export reports as image files* (para PNG) activados
6. [ ] *Recurrence* con zona horaria y hora de inicio, programado después de la actualización del modelo (§4)
7. [ ] Try/Catch, reintentos exponenciales, validación de filas y aviso con enlace a la ejecución (§6)
8. [ ] *Secure inputs/outputs* en las acciones con datos (§7.5)
9. [ ] Envío desde un buzón compartido y prueba en Outlook clásico, nuevo Outlook, web y móvil (guía PNG, §4)
10. [ ] Consumo de solicitudes estimado frente a la licencia y al throttling de los conectores (§5)

---

## Fuentes (Microsoft Learn)

**Power Automate**
- Limits of automated, scheduled, and instant flows: https://learn.microsoft.com/power-automate/limits-and-config
- Requests limits and allocations: https://learn.microsoft.com/power-platform/admin/api-request-limits-allocations
- Power Automate licensing FAQ: https://learn.microsoft.com/power-platform/admin/power-automate-licensing/faqs
- Understand platform limits and avoid throttling: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/understand-limits
- Run a cloud flow on a schedule: https://learn.microsoft.com/power-automate/run-scheduled-tasks
- Convert a time zone: https://learn.microsoft.com/power-automate/convert-time-zone
- Troubleshoot triggers: https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot
- Employ robust error handling: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/error-handling
- Secure data used in cloud flows: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/use-secure-inputs-outputs-triggers
- Create environment variables: https://learn.microsoft.com/power-automate/environment-variables
- Environment variables in solution cloud flows (limitaciones): https://learn.microsoft.com/power-apps/maker/data-platform/environmentvariables-power-automate
- Pre-populate connection references and environment variables: https://learn.microsoft.com/power-platform/alm/conn-ref-env-variables-build-tools

**Power BI**
- Conector Power BI: https://learn.microsoft.com/connectors/powerbi/
- Datasets - Execute Queries (REST): https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries
- Best practices for the Execute DAX Queries REST API: https://learn.microsoft.com/power-bi/developer/execute-dax-queries-arrow/best-practices
- Data refresh in Power BI: https://learn.microsoft.com/power-bi/connect-data/refresh-data
- Enhanced refresh with the REST API: https://learn.microsoft.com/power-bi/connect-data/asynchronous-refresh
- Export and email a Power BI report with Power Automate: https://learn.microsoft.com/power-bi/collaborate-share/office-integration/service-automate-power-bi-report-export
- Email subscriptions: https://learn.microsoft.com/power-bi/collaborate-share/end-user-subscribe
- Dynamic per recipient subscriptions: https://learn.microsoft.com/power-bi/collaborate-share/dynamic-subscriptions

**Gobierno y cumplimiento**
- Implement a data policy strategy: https://learn.microsoft.com/power-platform/guidance/adoption/dlp-strategy
- Connector classification: https://learn.microsoft.com/power-platform/admin/dlp-connector-classification
- Impact of data policies on apps and flows: https://learn.microsoft.com/power-platform/admin/dlp-impact-policies-apps-flows
- Advanced connector policies: https://learn.microsoft.com/power-platform/admin/advanced-connector-policies
- Manage the default environment: https://learn.microsoft.com/power-platform/guidance/adoption/manage-default-environment
- Secure the default environment: https://learn.microsoft.com/power-platform/guidance/adoption/secure-default-environment
- Establish tenant hygiene with the CoE Starter Kit: https://learn.microsoft.com/power-platform/guidance/coe/after-setup-tenant-hygiene
- HIPAA & HITECH: https://learn.microsoft.com/compliance/regulatory/offering-hipaa-hitech
- Compliance in Microsoft for Healthcare: https://learn.microsoft.com/industry/healthcare/compliance-overview
