"""C85 offline bootstrap / refit job.

This package is the durable build side of the C85 deployment split:

    bootstrap job  ->  versioned deployment bundle  ->  Railway serving worker

It runs the original historical producers and the original scheduled fits
(`continuation/`), reuses verified cached work, and exports a bundle that
carries only what serving needs. It is NOT imported by the serving worker.
"""
