# Defects and work proposals

The application taxonomy in `src/lib/iqn/defects.ts` contains 53 defect observations and four inspection/service requests covering the 29 IQN 02-24 work sections. These application IDs are not official IQN defect codes. Work references point to the user-provided document catalog and its source audit.

Pothole proposals require the planned repair thickness, largest individual patch area, and whether the old pavement is removed. Total defect area is not the individual patch area. The source resource norm is selected only when its conditions match; ambiguous norms are not automatically used. Time norms without a resource recipe, and the antiskid resource table without material consumption, require a recorded chief resource assessment in both manual and automatic planning. The assessment states its quantity basis, material amounts, machine-hours, and reason; explicit no-resource declarations remain distinct from missing data. It supplements missing source recipes and feeds the same stock, requisition, reservation and dispatch flow.

The UI label is “AI tavsiyasi”, with a visible demo disclosure. The current adapter uses deterministic, reviewed IQN mappings, not model inference. It prepares work, dates, crew and known resource demands. Preparation never creates or dispatches a work order. Chief approval, staffing availability and warehouse checks remain mandatory.

RoadVision import is a six-record simulation with stable identifiers. Repeating the import does not duplicate records. Samples have no invented measurements, confidence scores or media. The chief can correct the defect type and must confirm measured quantity in that type’s unit. A healthy detected asset is not a defect. The repository’s external RoadVision result contract remains proposed for vendor review; no live vendor result integration is claimed here.

Validation: 23 connected adapter scenarios and DOM interaction checks covering capture, chief review, automatic draft preparation, resource receipt, dispatch, RoadVision unit correction and late-response invalidation. The Sites Worker build also succeeds. No live-browser QA was performed for this change.

The proposal searches up to 14 days for a feasible crew and machine-time window. Material stock identity includes both code and normalized unit, so tonnes and cubic metres never share a balance. Resource-demand changes cancel pending supply requests; receipts remain in history. Received catalog materials appear in the warehouse view.
